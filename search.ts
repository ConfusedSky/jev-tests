import { normalize, singular, STOPWORDS } from "./answer";
import { timed } from "./shared";

/**
 * A word or phrase the text search looks for, with how much a line that
 * holds it earns. Subject terms outweigh the rest so that "hunting rifle"
 * beats a line listing "cost, weight, size".
 */
export type Term = { words: string[]; weight: number; subject: boolean };
export type Excerpt = { page: number; content: string; score: number };

/** Lower-case singular word stems, the form every match is made in. */
export const stems = (text: string): string[] => normalize(text).split(" ").filter(Boolean).map(singular);

const holds = (line: string[], t: Term) => ` ${line.join(" ")} `.includes(` ${t.words.join(" ")} `);

/** What to look for: the subject as a phrase and as words, then every other content word of the question. */
export function terms(question: string, subject: string[]): Term[] {
  const out: Term[] = [];
  const seen = new Set<string>();
  const add = (words: string[], weight: number, isSubject: boolean) => {
    const key = words.join(" ");
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ words, weight, subject: isSubject });
  };
  for (const name of subject) {
    const words = stems(name);
    if (words.length > 1) add(words, 3, true);
    for (const w of words) add([w], 2, true);
  }
  for (const w of stems(question)) if (!STOPWORDS.has(w) && w.length > 1) add([w], 1, false);
  return out;
}

const EXCERPT_CHARS = 200;

/** The line as the model should see it: columns and table cells set apart by a bar, quotes gone, around the first match. */
function content(line: string, first: Term | undefined): string {
  // Quotes and backticks would read as the instruction's own marks.
  const flat = line.replace(/["`\u0000-\u001f]/g, "").replace(/\s{3,}/g, " | ").trim();
  const at = first ? flat.search(new RegExp(`\\b${first.words[0]!}`, "i")) : 0;
  const start = Math.max(0, Math.min(at < 0 ? 0 : at - 60, flat.length - EXCERPT_CHARS));
  return flat.slice(start, start + EXCERPT_CHARS).trim();
}

type Found = { page: number; text: string; next: string };
type Book = { pages: number; lines: Found[] };

/** A stem as ripgrep should look for it: at a word's start, so "tag" finds "Tags", and "ability" finds "abilities". */
const pattern = (stem: string) => (stem.endsWith("y") ? `\\b${stem.slice(0, -1)}(y|ies)` : `\\b${stem}`);

/**
 * Every line of the cached texts holding a term, with its page and the line
 * after it, in one ripgrep over all the files. A page begins at a form
 * feed, which pdftotext puts at the head of the page's first line, so a
 * line's page is one more than the form feeds up to and on it.
 */
async function grep(files: string[], ts: Term[]): Promise<Map<string, Book>> {
  const patterns = ["\\x0c", ...new Set(ts.flatMap((t) => t.words).map(pattern))].flatMap((p) => ["-e", p]);
  const out = await timed("extract", async () => {
    const p = Bun.spawn(["rg", "--json", "-n", "-i", "-A1", "--no-messages", ...patterns, "--", ...files], { stdout: "pipe", stderr: "pipe" });
    const [text, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    // 1 is ripgrep's exit for "no match"; anything else is a fault.
    if ((await p.exited) > 1) throw new Error(`rg failed: ${err.trim()}`);
    return text;
  });
  const books = new Map<string, Book>();
  type Event = { type: string; data: { path: { text: string }; line_number?: number; lines?: { text: string } } };
  let book: Book | undefined;
  let last: (Found & { n: number }) | undefined;
  for (const line of out.split("\n")) {
    if (!line) continue;
    const e = JSON.parse(line) as Event;
    if (e.type === "begin") {
      book = { pages: 1, lines: [] };
      books.set(e.data.path.text, book);
      last = undefined;
    }
    if (!book || (e.type !== "match" && e.type !== "context")) continue;
    const text = e.data.lines!.text.replace(/\n$/, "");
    const n = e.data.line_number!;
    const feeds = text.split("\f").length - 1;
    // The line after is for a phrase split by the line break, never one split by a page.
    if (last && last.n === n - 1 && feeds === 0) last.next = text;
    book.pages += feeds;
    if (e.type === "match") {
      last = { page: book.pages, text, next: "", n };
      book.lines.push(last);
    }
  }
  return books;
}

/**
 * The pages of each file whose text mentions the question's subject, each
 * with its best line, ranked by how much of the question that line holds.
 * Terms are weighted by how rare they are across the file's pages, so a
 * line holding "hunting" (nine pages) beats one holding "cost" (a few
 * hundred) even when the subject was misread. A phrase is also looked for
 * across a line and the next, since -layout breaks a table cell and a
 * hyphenated word over two lines. A page counts only if its best line names
 * the subject, or two terms when the question named none, and the more of
 * its lines name the subject the higher it ranks: for "skills" every page
 * of a rulebook has a line, and the list has forty.
 */
export async function excerpts(
  files: string[],
  ts: Term[],
  { limit = 20, within }: { limit?: number; within?: (page: number) => boolean } = {},
): Promise<Map<string, Excerpt[]>> {
  const out = new Map<string, Excerpt[]>();
  const needsSubject = ts.some((t) => t.subject);
  for (const [file, book] of await grep(files, ts)) {
    const lines = book.lines.map((l) => ({ ...l, own: stems(l.text), joined: stems(`${l.text} ${l.next}`) }));
    const matching = (t: Term) => (l: (typeof lines)[number]) => (t.words.length > 1 ? holds(l.joined, t) : holds(l.own, t));
    const weighted = ts.map((t) => {
      const df = new Set(lines.filter(matching(t)).map((l) => l.page)).size;
      return { ...t, weight: t.weight * Math.log(book.pages / Math.max(df, 1)) };
    });
    const best = new Map<number, Excerpt & { dense: number }>();
    for (const l of lines) {
      if (within && !within(l.page)) continue;
      const matched = weighted.filter((t) => matching(t)(l));
      if (matched.length === 0) continue;
      if (needsSubject ? !matched.some((t) => t.subject) : matched.length < 2) continue;
      const score = matched.reduce((sum, t) => sum + t.weight, 0);
      const b = best.get(l.page);
      if (!b) best.set(l.page, { page: l.page, content: content(l.text, matched[0]), score, dense: 1 });
      else {
        b.dense++;
        if (score > b.score) Object.assign(b, { content: content(l.text, matched[0]), score });
      }
    }
    const ranked = [...best.values()]
      .map(({ dense, ...e }) => ({ ...e, score: e.score + Math.log1p(dense) }))
      .sort((a, b) => b.score - a.score || a.page - b.page)
      .slice(0, limit);
    out.set(file, ranked);
  }
  return out;
}
