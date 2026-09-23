import { noul, type TypeSafeClient } from "@typesafe-ai/sdk";
import { rankTitles, secs, snapshot, split, timed } from "./shared";
import type { Answer, Judged, OutlineAnswer } from "./answer";
import type { Box } from "./layout";

export type Section = { path: string; start: number; end: number };
export type Hit = { pdf: string; section: string; page: number; p: number; text: string; answer?: Answer };
/** A window that answered, with whatever the answer layer read out of it. */
export type Candidate = { hit: Hit; answer: Answer };
export type Tried = { name: string; page: number; p: number };
/** Windows that held the pages but yielded no answer to fall back on, such as a count "not stated". */
/** `hits` holds every window taken, best first; `hit` is the first of them. */
export type Outcome = { hit?: Hit; hits: Hit[]; tried: Tried[]; rejected: Candidate[]; dropped: Candidate[] };

/** Progress goes to stderr and the hit to stdout, so redirecting one never hides the other. */
export type Ui = { log: (line: string) => void; trying: (line: string) => void; clear: () => void };

export function makeUi(quiet: boolean): Ui {
  const live = !quiet && process.stderr.isTTY;
  return {
    log: (line) => {
      if (!quiet) console.error(line);
    },
    trying: (line) => {
      if (live) process.stderr.write(`\u001b[2m  … ${line}\u001b[0m\r`);
    },
    clear: () => {
      if (live) process.stderr.write("\u001b[2K");
    },
  };
}

export function run(cmd: string[]): Promise<string> {
  return timed("extract", async () => {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    if ((await p.exited) !== 0) throw new Error(`${cmd[0]} failed: ${err.trim()}`);
    return out;
  });
}

/** outline.js prints "path\tstart\tend"; entries whose destination did not resolve print "null". */
export function parseOutline(tsv: string): Section[] {
  return tsv
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .filter((f) => f.length === 3 && f[1] !== "null")
    .map(([path, start, end]) => ({ path: path!, start: Number(start), end: Number(end) }));
}

export async function outline(pdf: string): Promise<Section[]> {
  const script = Bun.fileURLToPath(new URL("outline.js", import.meta.url));
  return parseOutline(await run(["mutool", "run", script, pdf]));
}

export type Window = { page: number; text: string };

/**
 * Section text split into windows small enough for one call, each tagged with
 * its first page. A `chars` of 0 puts every page in a window of its own, so a
 * hit names the exact page rather than the first of a span.
 */
export async function windows(pdf: string, s: Section, chars: number): Promise<Window[]> {
  // -layout keeps a table's row on one line and two prose columns side by
  // side; reading order interleaved the columns line by line and put each
  // table cell on a line of its own, three lines from its label.
  const text = (await run(["pdftotext", "-layout", "-f", String(s.start), "-l", String(s.end), pdf, "-"])).replace(
    /[ \t]+$/gm,
    "",
  );
  const out: Window[] = [];
  let buf = "";
  let first = s.start;
  text.split("\f").forEach((page, i) => {
    if (buf && buf.length + page.length > chars) {
      out.push({ page: first, text: buf });
      buf = "";
      first = s.start + i;
    }
    buf += page;
  });
  if (buf.trim()) out.push({ page: first, text: buf });
  return out.filter((w) => w.text.trim().length > 200);
}

/** Page count, for turning an outline-less PDF into one synthetic section. */
export async function pageCount(pdf: string): Promise<number> {
  const out = await run(["pdfinfo", pdf]);
  return Number(/^Pages:\s+(\d+)$/m.exec(out)?.[1] ?? 0);
}

/**
 * Whole-document page windows, for a PDF with no outline. Ranking them by
 * their opening text was worse than useless (a 300-character snippet judged
 * a credits page above the body) and the walk stops at the first yes anyway,
 * so they are simply read in page order.
 */
export async function pageScan(pdf: string, chars: number): Promise<Window[]> {
  const pages = await pageCount(pdf);
  if (pages === 0) return [];
  return windows(pdf, { path: "", start: 1, end: pages }, chars);
}

/**
 * A copy of the PDF with the passage's lines highlighted on its page, in the
 * cache, for a link to land on the answer rather than the page. Every run
 * copies afresh, since a highlight saved into the copy stays there; several
 * hits in one file each add theirs to the same copy.
 */
export async function highlighted(pdf: string, page: number, lines: Box[], fresh = true): Promise<string> {
  const dir = `${process.env.XDG_CACHE_HOME ?? `${process.env.HOME}/.cache`}/jev`;
  const copy = `${dir}/${pdf.split("/").pop()}`;
  if (fresh) await Bun.write(copy, Bun.file(pdf));
  const quads = lines.map((l) => [l.x0, l.y0, l.x1, l.y0, l.x0, l.y1, l.x1, l.y1]);
  const script = Bun.fileURLToPath(new URL("highlight.js", import.meta.url));
  await run(["mutool", "run", script, copy, String(page), JSON.stringify(quads)]);
  return copy;
}

export function pageUrl(pdf: string, page: number): string {
  return `${Bun.pathToFileURL(pdf).href}#page=${page}`;
}

export function link(pdf: string, page: number): string {
  const url = pageUrl(pdf, page);
  if (!process.stdout.isTTY) return url;
  return `\u001b]8;;${url}\u0007${pdf.split("/").pop()} p.${page}\u001b]8;;\u0007`;
}

// xdg-open truncates a file:// URL at the "#", so the page anchor only
// survives if the handler is launched directly.
export async function openAt(url: string): Promise<void> {
  const id = (await run(["xdg-mime", "query", "default", "application/pdf"])).trim();
  for (const dir of [`${process.env.HOME}/.local/share/applications`, "/usr/share/applications"]) {
    const f = Bun.file(`${dir}/${id}`);
    if (!(await f.exists())) continue;
    const exec = /^Exec=(\S+)/m.exec(await f.text());
    if (!exec) break;
    Bun.spawn([exec[1]!, url], { stdout: "ignore", stderr: "ignore" }).unref();
    return;
  }
  console.error(`could not resolve a PDF handler (${id}); open the URL yourself`);
}

/**
 * A count is derived, not stated: no page of the Fallout rulebook says there
 * are 94 perks, so asking whether a window "contains the answer" rejects the
 * very pages the perks are listed on. A count asks for the list instead.
 */
export type Gate = (of: string) => string;
export const GATE = {
  answer: (of) => `${of} contains the answer to \`question\``,
  list: (of) => `${of} lists entries of the kind \`question\` asks how many there are`,
  // A negative has no answer on the page to contain: Heart's class list
  // gated at 0.32 for "Is knight a class?" asked the first way, 0.76 this way.
  claim: (of) =>
    `${of} settles the claim in \`question\`: states it, contradicts it, or names the things of its kind so that the one named can be checked against them`,
} satisfies Record<string, Gate>;

async function askWindow(client: TypeSafeClient, question: string, section: string, text: string, gate: Gate) {
  const res = await timed("api", () =>
    client.systemOne({ state: { question, section, text }, questions: { answers: noul(gate("`text`")) } }),
  );
  return res.answers.answers.noul;
}

/**
 * Gates many pages in one call, a question per page over one state. Shown the
 * pages together the model contrasts them: on a 24-page section the runner-up
 * page sat at 0.03 this way and at 0.33 when each page was asked alone.
 */
async function askPages(client: TypeSafeClient, question: string, section: string, pages: Window[], gate: Gate) {
  const key = (w: Window) => `p${w.page}`;
  const res = await client.systemOne({
    state: { question, section, pages: Object.fromEntries(pages.map((w) => [key(w), w.text])) },
    questions: Object.fromEntries(pages.map((w) => [key(w), noul(gate(`\`pages.${key(w)}\``))])),
  });
  return pages.map((w) => res.answers[key(w)]!.noul);
}

/** Pages packed into batches of at most `chars`; a page over the limit travels alone. */
export function batches(pages: Window[], chars: number): Window[][] {
  const out: Window[][] = [];
  let size = Infinity;
  for (const w of pages) {
    if (size + w.text.length > chars) {
      out.push([]);
      size = 0;
    }
    out.at(-1)!.push(w);
    size += w.text.length;
  }
  return out;
}

/**
 * Checks the answer a window actually yields. Finding the right pages and
 * reading a value out of them fail independently: a section can clearly be
 * about skills while the count inside it comes back at p=0.32. A "keep"
 * verdict lets the walk go on instead of settling for that.
 */
export type Verify = (section: string, page: number, text: string, pdf: string) => Promise<Judged>;

export type SearchOpts = {
  question: string;
  threshold: number;
  titleFloor: number;
  max: number;
  chars: number;
  batch: number;
  /** Every page gated on its own, in batches of `chars`, so the hit is the page itself. */
  perPage?: boolean;
  maxAnswers?: number;
  /** Windows to collect before stopping; the default stops at the first that passes. */
  hits?: number;
  verify?: Verify;
  /** Tries the table of contents before any page is read; may instead name the section to read. */
  fromOutline?: (sections: Section[]) => Promise<OutlineAnswer | undefined>;
  /** What a window must satisfy to be worth reading out; see GATE. */
  gate?: Gate;
  /** Counts a whole section at once, for a list too long to fit one window. */
  countAcross?: (section: string, windows: Window[]) => Promise<Judged>;
};

/**
 * The sections a contents pointer confines the walk to: the section, its
 * descendants, and the pages of its parent that come before the parent's
 * first section. Heart's callings each get two pages of their own and no
 * page under Callings lists all five; the list is in the Characters chapter
 * opening, before Callings begins.
 */
export function confine(sections: Section[], parent: string): Section[] {
  const pool = sections.filter((s) => s.path === parent || s.path.startsWith(`${parent} > `));
  const cut = parent.lastIndexOf(" > ");
  if (cut < 0) return pool;
  const above = parent.slice(0, cut);
  const chapter = sections.find((s) => s.path === above);
  if (!chapter) return pool;
  const first = Math.min(...sections.filter((s) => s.path.startsWith(`${above} > `)).map((s) => s.start));
  if (first > chapter.start) pool.push({ path: `${above} (opening)`, start: chapter.start, end: first - 1 });
  return pool;
}

/**
 * Rank a PDF's outline by title, then read sections in that order until one
 * answers the question. Returns the first hit, or the attempts that failed.
 */
export async function searchPdf(
  client: TypeSafeClient,
  pdf: string,
  o: SearchOpts,
  ui: Ui,
  indent = "",
): Promise<Outcome> {
  const tried: Tried[] = [];
  const rejected: Candidate[] = [];
  const dropped: Candidate[] = [];
  const maxAnswers = o.maxAnswers ?? 5;
  const chars = o.perPage ? 0 : o.chars;
  const hits: Hit[] = [];
  const wanted = o.hits ?? 1;
  const done = (): Outcome => ({ hit: hits[0], hits, tried, rejected, dropped });
  /** Keeps a taken window; true once enough have been taken to stop. */
  const took = (hit: Hit) => hits.push(hit) >= wanted;
  // Sections a count has read in full: their descendants can only re-count a
  // fragment of the same pages, so they are neither read nor kept as fallbacks.
  const counted: string[] = [];

  const gate = o.gate ?? GATE.answer;
  type Passed = { w: Window; p: number; label: string };

  /**
   * The windows worth reading out, best first. Whole windows are gated one at
   * a time and stop at the first yes. Pages are gated a batch at a time, each
   * batch as big as a whole window, so the walk spends the same calls and
   * stops at the same place; within a batch the best page is read first.
   */
  async function* passed(ws: Window[], name: string, label: (w: Window, i: number) => string): AsyncGenerator<Passed> {
    if (!o.perPage) {
      for (const [i, w] of ws.entries()) {
        ui.trying(label(w, i));
        const t = Date.now();
        const p = await askWindow(client, o.question, name, w.text, gate);
        tried.push({ name, page: w.page, p });
        ui.clear();
        const yes = p >= o.threshold;
        ui.log(`${indent}  ${yes ? "yes" : "no "}  ${p.toFixed(2)}  ${secs(Date.now() - t).padStart(5)} jev  ${label(w, i)}`);
        if (yes) yield { w, p, label: label(w, i) };
      }
      return;
    }
    const groups = batches(ws, o.chars);
    let i = 0;
    for (const [g, group] of groups.entries()) {
      const batch = `batch ${g + 1}/${groups.length}`;
      ui.trying(`${name} ${group.length} pages (${batch})`);
      const t = Date.now();
      const ps = await timed("api", () => askPages(client, o.question, name, group, gate));
      ui.clear();
      const scored = group.map((w, j) => ({ w, p: ps[j]!, label: label(w, i + j) }));
      i += group.length;
      for (const { w, p } of scored) tried.push({ name, page: w.page, p });
      const yes = scored.filter((s) => s.p >= o.threshold).sort((a, b) => b.p - a.p);
      ui.log(`${indent}  gated ${group.length} pages (${batch}), ${secs(Date.now() - t)} jev, ${yes.length} yes  ${name}`);
      for (const s of scored) ui.log(`${indent}  ${s.p >= o.threshold ? "yes" : "no "}  ${s.p.toFixed(2)}  ${s.label}`);
      yield* yes;
    }
  }

  /**
   * Reads the answer out of a window that passed. Returns the hit to stop on,
   * "spent" once maxAnswers windows have answered below the floor, or
   * undefined to keep walking.
   */
  const settle = async ({ w, p, label }: Passed, name: string, all?: Window[]): Promise<Hit | "spent" | undefined> => {
    let hit: Hit = { pdf, section: name, page: w.page, p, text: w.text };
    // A list can outrun one window, so a count reads the whole section rather
    // than the window that happened to answer. It links to the first page
    // that counted something and that the gate did not call a no: Heart's
    // domains page is preceded by one that mentions a domain in passing, and
    // the gate put that page at 0.10. The stop threshold is too strict here:
    // the Fallout perk pages gate at 0.6 apiece with one at 0.71.
    let check: Promise<Judged> | undefined;
    if (all && all.length > 1 && o.countAcross) {
      counted.push(name);
      const fragments = rejected.filter((c) => c.hit.section.startsWith(`${name} > `));
      for (const f of fragments) {
        rejected.splice(rejected.indexOf(f), 1);
        dropped.push(f);
        ui.log(`${indent}  drop  ${f.answer.text} (p=${f.answer.p.toFixed(2)})  ${f.hit.section}  part of ${name}`);
      }
      check = o.countAcross(name, all);
    } else check = o.verify?.(name, w.page, w.text, pdf);
    if (!check) return hit;
    const { verdict, pages, ...answer } = await check;
    if (pages?.length) {
      const gated = new Set(tried.filter((t) => t.name === name && t.p >= 0.5).map((t) => t.page));
      hit = { ...hit, page: pages.find((p) => gated.has(p)) ?? pages[0]! };
    }
    // A passage is lines of text; the log gets its first line, cut short.
    const shown = answer.text.includes("\n") || answer.text.length > 60 ? `${answer.text.split("\n")[0]!.slice(0, 57)}…` : answer.text;
    ui.log(`${indent}  ${verdict}  ${shown} (p=${answer.p.toFixed(2)})  ${label}`);
    if (verdict === "take") return { ...hit, answer };
    (verdict === "keep" ? rejected : dropped).push({ hit, answer });
    return rejected.length >= maxAnswers ? "spent" : undefined;
  };

  const sections = await outline(pdf);
  if (sections.length === 0) {
    const scanSnap = snapshot();
    const ws = await pageScan(pdf, chars);
    if (ws.length === 0) {
      ui.log(`${indent}  --  no outline and no extractable text  ${pdf}`);
      return done();
    }
    ui.log(`${indent}no outline: scanning ${ws.length} windows in page order, read in ${split(scanSnap)}`);
    const nameOf = (w: Window, i: number) => {
      const next = ws[i + 1];
      return o.perPage ? `p.${w.page}` : next ? `p.${w.page}-${next.page - 1}` : `p.${w.page}+`;
    };
    for await (const c of passed(ws, "", (w, i) => `${nameOf(w, i)} (window ${i + 1}/${ws.length})`)) {
      const out = await settle(c, nameOf(c.w, ws.indexOf(c.w)));
      if (out === "spent") break;
      if (out && took(out)) return done();
    }
    return done();
  }

  // The contents may settle the question, or only say which section can. In
  // the second case the walk is confined to that section and its children,
  // and the title floor no longer applies: the section was already picked.
  let pool = sections;
  let floor = o.titleFloor;
  if (o.fromOutline) {
    const outlineSnap = snapshot();
    const toc = await o.fromOutline(sections);
    if (toc?.answer) {
      const at = sections.find((s) => s.path === toc.parent)!;
      ui.log(`${indent}  toc   ${toc.answer.text} (p=${toc.answer.p.toFixed(2)})  ${toc.parent}  in ${split(outlineSnap)}`);
      took({ pdf, section: toc.parent, page: at.start, p: toc.answer.p, text: "", answer: toc.answer });
      return done();
    }
    if (toc) {
      pool = confine(sections, toc.parent);
      floor = -Infinity;
      ui.log(`${indent}  toc   reading ${toc.parent} (${pool.length} sections)  in ${split(outlineSnap)}`);
    }
  }

  const rankSnap = snapshot();
  const all = await rankTitles(client, o.question, pool.map((s) => s.path), o.batch, "section");
  const ranked = all.slice(0, o.max);
  const above = all.filter((r) => r.score >= floor).length;
  ui.log(
    `${indent}ranked ${all.length} sections in ${split(rankSnap)}, ` +
      `${above} above title floor ${floor}` +
      (all.length > above ? ` (${all.length - above} below)` : ""),
  );

  const byPath = new Map([...sections, ...pool].map((s) => [s.path, s]));
  // A parent and its only child, or siblings on one page, resolve to the same
  // pages; reading them twice would cost a call and change nothing.
  const read = new Set<string>();
  let below = false;
  for (const r of ranked) {
    // The floor is soft: a title that scored under it is read only while
    // nothing has answered, so a book whose titles say little still gets
    // searched, bounded by --max. Above the floor -n windows are collected;
    // below it one is enough. With -n 1 the floor only marks the log, since
    // the walk stops at the first hit anyway.
    if (r.score < floor) {
      if (hits.length > 0) break;
      if (!below) ui.log(`${indent}  nothing above the title floor answered; reading on below it`);
      below = true;
    }
    const s = byPath.get(r.name)!;
    const under = counted.find((c) => r.name.startsWith(`${c} > `));
    if (under) {
      ui.log(`${indent}  --    ${r.name}  already counted under ${under}`);
      continue;
    }
    if (read.has(`${s.start}-${s.end}`)) continue;
    read.add(`${s.start}-${s.end}`);
    const sectionSnap = snapshot();
    const ws = await windows(pdf, s, chars);
    if (ws.length === 0) {
      ui.clear();
      ui.log(`${indent}  --    ${split(sectionSnap)}  ${r.name}  p.${s.start}-${s.end}  no extractable text`);
      continue;
    }
    const wholeSection = Boolean(o.countAcross && ws.length > 1);
    const label = (w: Window, i: number) => `${r.name} p.${w.page}${ws.length > 1 ? ` (window ${i + 1}/${ws.length})` : ""}`;
    for await (const c of passed(ws, r.name, label)) {
      const out = await settle(c, r.name, ws);
      if (out === "spent") return done();
      if (out && took(out)) {
        ui.log(`${indent}section ${split(sectionSnap)}`);
        return done();
      }
      // A section-wide count already read every window, so the rest are spent.
      if (wholeSection) break;
    }
    if (ws.length > 1) ui.log(`${indent}  section ${split(sectionSnap)}  ${r.name}`);
  }
  return done();
}
