import { noul, type TypeSafeClient } from "@typesafe-ai/sdk";
import { rankTitles, secs, snapshot, split, timed } from "./shared";
import type { Answer, Judged, OutlineAnswer } from "./answer";

export type Section = { path: string; start: number; end: number };
export type Hit = { pdf: string; section: string; page: number; p: number; text: string; answer?: Answer };
/** A window that answered, with whatever the answer layer read out of it. */
export type Candidate = { hit: Hit; answer: Answer };
export type Tried = { name: string; page: number; p: number };
/** Windows that held the pages but yielded no answer to fall back on, such as a count "not stated". */
export type Outcome = { hit?: Hit; tried: Tried[]; rejected: Candidate[]; dropped: Candidate[] };

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

/** Section text split into windows small enough for one call, each tagged with its first page. */
export async function windows(pdf: string, s: Section, chars: number): Promise<Window[]> {
  const text = await run(["pdftotext", "-f", String(s.start), "-l", String(s.end), pdf, "-"]);
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
export const GATE = {
  answer: "The text contains the answer to the question",
  list: "The text lists entries of the kind the question asks about",
} as const;

async function askWindow(
  client: TypeSafeClient,
  question: string,
  section: string,
  text: string,
  gate: string,
): Promise<number> {
  const res = await timed("api", () =>
    client.systemOne({ state: { question, section, text }, questions: { answers: noul(gate) } }),
  );
  return res.answers.answers.noul;
}

/**
 * Checks the answer a window actually yields. Finding the right pages and
 * reading a value out of them fail independently: a section can clearly be
 * about skills while the count inside it comes back at p=0.32. A "keep"
 * verdict lets the walk go on instead of settling for that.
 */
export type Verify = (section: string, page: number, text: string) => Promise<Judged>;

export type SearchOpts = {
  question: string;
  threshold: number;
  titleFloor: number;
  max: number;
  chars: number;
  batch: number;
  maxAnswers?: number;
  verify?: Verify;
  /** Tries the table of contents before any page is read; may instead name the section to read. */
  fromOutline?: (sections: Section[]) => Promise<OutlineAnswer | undefined>;
  /** What a window must satisfy to be worth reading out; see GATE. */
  gate?: string;
  /** Counts a whole section at once, for a list too long to fit one window. */
  countAcross?: (section: string, windows: Window[]) => Promise<Judged>;
};

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
  const done = (hit?: Hit): Outcome => ({ hit, tried, rejected, dropped });

  /**
   * Asks one window. Returns the hit to stop on, "spent" once maxAnswers
   * windows have answered below the floor, or undefined to keep walking.
   */
  const visit = async (w: Window, name: string, label: string, all?: Window[]): Promise<Hit | "spent" | undefined> => {
    ui.trying(label);
    const t = Date.now();
    const p = await askWindow(client, o.question, name, w.text, o.gate ?? GATE.answer);
    tried.push({ name, page: w.page, p });
    ui.clear();
    const yes = p >= o.threshold;
    ui.log(`${indent}  ${yes ? "yes" : "no "}  ${p.toFixed(2)}  ${secs(Date.now() - t).padStart(5)} jev  ${label}`);
    if (!yes) return undefined;

    const hit: Hit = { pdf, section: name, page: w.page, p, text: w.text };
    // A list can outrun one window, so a count reads the whole section rather
    // than the window that happened to answer.
    const check = all && all.length > 1 && o.countAcross ? o.countAcross(name, all) : o.verify?.(name, w.page, w.text);
    if (!check) return hit;
    const { verdict, ...answer } = await check;
    ui.log(`${indent}  ${verdict}  ${answer.text} (p=${answer.p.toFixed(2)})  ${label}`);
    if (verdict === "take") return { ...hit, answer };
    (verdict === "keep" ? rejected : dropped).push({ hit, answer });
    return rejected.length >= maxAnswers ? "spent" : undefined;
  };

  const sections = await outline(pdf);
  if (sections.length === 0) {
    const scanSnap = snapshot();
    const ws = await pageScan(pdf, o.chars);
    if (ws.length === 0) {
      ui.log(`${indent}  --  no outline and no extractable text  ${pdf}`);
      return done();
    }
    ui.log(`${indent}no outline: scanning ${ws.length} windows in page order, read in ${split(scanSnap)}`);
    for (const [i, w] of ws.entries()) {
      const next = ws[i + 1];
      const name = next ? `p.${w.page}-${next.page - 1}` : `p.${w.page}+`;
      const out = await visit(w, name, `${name} (window ${i + 1}/${ws.length})`);
      if (out === "spent") break;
      if (out) return done(out);
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
      return done({ pdf, section: toc.parent, page: at.start, p: toc.answer.p, text: "", answer: toc.answer });
    }
    if (toc) {
      pool = sections.filter((s) => s.path === toc.parent || s.path.startsWith(`${toc.parent} > `));
      floor = -Infinity;
      ui.log(`${indent}  toc   reading ${toc.parent} (${pool.length} sections)  in ${split(outlineSnap)}`);
    }
  }

  const rankSnap = snapshot();
  const all = await rankTitles(client, o.question, pool.map((s) => s.path), o.batch, "section");
  const ranked = all.filter((r) => r.score >= floor).slice(0, o.max);
  ui.log(
    `${indent}ranked ${all.length} sections in ${split(rankSnap)}, ` +
      `${ranked.length} above title floor ${floor}` +
      (all.length > ranked.length ? ` (${all.length - ranked.length} skipped)` : ""),
  );

  const byPath = new Map(sections.map((s) => [s.path, s]));
  // A parent and its only child, or siblings on one page, resolve to the same
  // pages; reading them twice would cost a call and change nothing.
  const read = new Set<string>();
  for (const r of ranked) {
    const s = byPath.get(r.name)!;
    if (read.has(`${s.start}-${s.end}`)) continue;
    read.add(`${s.start}-${s.end}`);
    const sectionSnap = snapshot();
    const ws = await windows(pdf, s, o.chars);
    if (ws.length === 0) {
      ui.clear();
      ui.log(`${indent}  --    ${split(sectionSnap)}  ${r.name}  p.${s.start}-${s.end}  no extractable text`);
      continue;
    }
    const whole = Boolean(o.countAcross && ws.length > 1);
    for (const [i, w] of ws.entries()) {
      const span = ws.length > 1 ? `p.${w.page} (window ${i + 1}/${ws.length})` : `p.${w.page}`;
      const out = await visit(w, r.name, `${r.name} ${span}`, ws);
      if (out === "spent") return done();
      if (out) {
        ui.log(`${indent}section ${split(sectionSnap)}`);
        return done(out);
      }
      // A section-wide count already read every window, so the rest are spent.
      if (whole && tried.at(-1)!.p >= o.threshold) break;
    }
    if (ws.length > 1) ui.log(`${indent}  section ${split(sectionSnap)}  ${r.name}`);
  }
  return done();
}
