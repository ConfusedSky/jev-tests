import { normalize, singular, STOPWORDS } from "./answer";

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

/**
 * Terms reweighted by how rare they are across the book's pages: "cost" is
 * on a few hundred Fallout pages and "hunting" on nine, so even when the
 * subject was misread, a line with the rare word wins.
 */
export function weighted(ts: Term[], pages: string[]): Term[] {
  const stemmed = pages.map(stems);
  return ts.map((t) => {
    const df = stemmed.filter((p) => holds(p, t)).length;
    return { ...t, weight: t.weight * Math.log(pages.length / Math.max(df, 1)) };
  });
}

const EXCERPT_CHARS = 200;

/** The line as the model should see it: columns and table cells set apart by a bar, quotes gone, around the first match. */
function content(line: string, first: Term | undefined): string {
  const flat = line.replace(/["\u0000-\u001f]/g, "").replace(/\s{3,}/g, " | ").trim();
  const at = first ? flat.search(new RegExp(`\\b${first.words[0]!.replace(/[^a-z0-9]/g, "")}`, "i")) : 0;
  const start = Math.max(0, Math.min(at < 0 ? 0 : at - 60, flat.length - EXCERPT_CHARS));
  return flat.slice(start, start + EXCERPT_CHARS).trim();
}

/**
 * The pages whose text mentions the question's subject, each with its best
 * line, ranked by how much of the question that line holds. A phrase is
 * also looked for across a line and the next, since -layout breaks a table
 * cell and a hyphenated word over two lines. A page counts only if its best
 * line names the subject, or two terms when the question named none, and
 * the more of its lines name the subject the higher it ranks: for "skills"
 * every page of a rulebook has a line, and the list has forty.
 */
export function excerpts(pages: string[], ts: Term[], { limit = 20, within }: { limit?: number; within?: (page: number) => boolean } = {}): Excerpt[] {
  const needsSubject = ts.some((t) => t.subject);
  const out: Excerpt[] = [];
  pages.forEach((text, i) => {
    const page = i + 1;
    if (within && !within(page)) return;
    const lines = text.split("\n");
    const stemmed = lines.map(stems);
    let best: Excerpt | undefined;
    let dense = 0;
    lines.forEach((line, j) => {
      const own = stemmed[j]!;
      const joined = own.concat(stemmed[j + 1] ?? []);
      const matched = ts.filter((t) => (t.words.length > 1 ? holds(joined, t) : holds(own, t)));
      if (matched.length === 0) return;
      if (needsSubject ? !matched.some((t) => t.subject) : matched.length < 2) return;
      dense++;
      const score = matched.reduce((sum, t) => sum + t.weight, 0);
      if (!best || score > best.score) best = { page, content: content(line, matched[0]), score };
    });
    if (best) out.push({ ...best, score: best.score + Math.log1p(dense) });
  });
  return out.sort((a, b) => b.score - a.score || a.page - b.page).slice(0, limit);
}
