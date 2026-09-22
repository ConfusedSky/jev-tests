import { noul, type NoulResponse, type TypeSafeClient } from "@typesafe-ai/sdk";
import { rankTitles, snapshot, split, timed, type Snapshot } from "./shared";

export type Section = { path: string; start: number; end: number };
export type Hit = {
  pdf: string;
  section: string;
  page: number;
  p: number;
  text: string;
  answer?: { text: string; p: number };
};
/** A window that answered, with whatever the answer layer read out of it. */
export type Candidate = { hit: Hit; answer: { text: string; p: number } };
export type Tried = { name: string; page: number; p: number };

export const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Progress goes to stderr and the hit to stdout, so redirecting one never hides the other. */
export function makeUi(quiet: boolean) {
  return {
    log: (line: string) => quiet || console.error(line),
    trying: (line: string) => {
      if (!quiet && process.stderr.isTTY) process.stderr.write(`\u001b[2m  … ${line}\u001b[0m\r`);
    },
    clear: () => {
      if (!quiet && process.stderr.isTTY) process.stderr.write("\u001b[2K");
    },
  };
}
export type Ui = ReturnType<typeof makeUi>;

export async function run(cmd: string[]): Promise<string> {
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

/** Section text split into windows small enough for one call, each tagged with its first page. */
export async function windows(pdf: string, s: Section, chars: number) {
  const text = await run(["pdftotext", "-f", String(s.start), "-l", String(s.end), pdf, "-"]);
  const pages = text.split("\f");
  const out: { page: number; text: string }[] = [];
  let buf = "";
  let first = s.start;
  pages.forEach((page, i) => {
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
 * their opening text was worse than useless — a 300-character snippet judged
 * a credits page above the body — and the walk stops at the first yes anyway,
 * so they are simply read in page order.
 */
export async function pageScan(pdf: string, chars: number) {
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

async function askWindow(
  client: TypeSafeClient,
  question: string,
  section: string,
  text: string,
): Promise<number> {
  const res = await timed("api", () =>
    client.systemOne({
      state: { question, section, text },
      questions: { answers: noul("The text contains the answer to the question") },
    }),
  );
  return (res.answers.answers as NoulResponse).noul;
}

/**
 * Checks the answer a window actually yields. Finding the right pages and
 * reading a value out of them fail independently: a section can clearly be
 * about skills while the count inside it comes back at p=0.32. Returning
 * `ok: false` keeps the walk going instead of settling for that.
 */
export type Verify = (section: string, page: number, text: string) => Promise<{ text: string; p: number; ok: boolean }>;

export type SearchOpts = {
  question: string;
  threshold: number;
  titleFloor: number;
  max: number;
  chars: number;
  batch: number;
  maxAnswers?: number;
  verify?: Verify;
  /** Tries the table of contents before any page is read. */
  fromOutline?: (paths: string[]) => Promise<{ answer: { text: string; p: number }; parent: string } | undefined>;
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
): Promise<{ hit?: Hit; tried: Tried[]; rejected: Candidate[] }> {
  const tried: Tried[] = [];
  const rejected: Candidate[] = [];
  const maxAnswers = o.maxAnswers ?? 5;

  /** Returns the hit to stop on, or undefined to keep walking. */
  const settle = async (hit: Hit, label: string): Promise<Hit | undefined> => {
    if (!o.verify) return hit;
    const a = await o.verify(hit.section, hit.page, hit.text);
    ui.log(`${indent}  ${a.ok ? "take" : "keep"}  ${a.text} (p=${a.p.toFixed(2)})  ${label}`);
    const answer = { text: a.text, p: a.p };
    if (a.ok) return { ...hit, answer };
    rejected.push({ hit, answer });
    return undefined;
  };
  const sections = await outline(pdf);
  if (sections.length === 0) {
    const scanSnap = snapshot();
    const ws = await pageScan(pdf, o.chars);
    if (ws.length === 0) {
      ui.log(`${indent}  --  no outline and no extractable text  ${pdf}`);
      return { tried, rejected };
    }
    ui.log(`${indent}no outline: scanning ${ws.length} windows in page order, read in ${split(scanSnap)}`);
    for (const [i, w] of ws.entries()) {
      const end = i + 1 < ws.length ? ws[i + 1]!.page - 1 : "";
      const name = `p.${w.page}${end ? `-${end}` : "+"}`;
      ui.trying(`${name} (window ${i + 1}/${ws.length})`);
      const windowSnap = snapshot();
      const p = await askWindow(client, o.question, name, w.text);
      tried.push({ name, page: w.page, p });
      ui.clear();
      const hit = p >= o.threshold;
      ui.log(`${indent}  ${hit ? "yes" : "no "}  ${p.toFixed(2)}  ${secs(Date.now() - windowSnap.at).padStart(5)} jev  ${name} (window ${i + 1}/${ws.length})`);
      if (hit) {
        const settled = await settle({ pdf, section: name, page: w.page, p, text: w.text }, name);
        if (settled) return { hit: settled, tried, rejected };
        if (rejected.length >= maxAnswers) break;
      }
    }
    return { tried, rejected };
  }

  if (o.fromOutline) {
    const outlineSnap = snapshot();
    const fromToc = await o.fromOutline(sections.map((s) => s.path));
    if (fromToc) {
      const at = sections.find((s) => s.path === fromToc.parent)!;
      ui.log(`${indent}  toc   ${fromToc.answer.text} (p=${fromToc.answer.p.toFixed(2)})  ${fromToc.parent}  in ${split(outlineSnap)}`);
      return {
        hit: { pdf, section: fromToc.parent, page: at.start, p: fromToc.answer.p, text: "", answer: fromToc.answer },
        tried,
        rejected,
      };
    }
  }

  const rankSnap = snapshot();
  const all = await rankTitles(client, o.question, sections.map((s) => s.path), o.batch, "section");
  const ranked = all.filter((r) => r.score >= o.titleFloor).slice(0, o.max);
  ui.log(
    `${indent}ranked ${all.length} sections in ${split(rankSnap)}, ` +
      `${ranked.length} above title floor ${o.titleFloor}` +
      (all.length > ranked.length ? ` (${all.length - ranked.length} skipped)` : ""),
  );

  const byPath = new Map(sections.map((s) => [s.path, s]));
  for (const r of ranked) {
    const s = byPath.get(r.name)!;
    const sectionSnap = snapshot();
    const ws = await windows(pdf, s, o.chars);
    if (ws.length === 0) {
      ui.clear();
      ui.log(`${indent}  --    ${split(sectionSnap)}  ${r.name}  p.${s.start}-${s.end}  no extractable text`);
      continue;
    }
    for (const [i, w] of ws.entries()) {
      const span = ws.length > 1 ? ` p.${w.page} (window ${i + 1}/${ws.length})` : ` p.${w.page}`;
      ui.trying(`${r.name}${span}`);
      const windowSnap = snapshot();
      const p = await askWindow(client, o.question, r.name, w.text);
      tried.push({ name: r.name, page: w.page, p });
      ui.clear();
      const hit = p >= o.threshold;
      ui.log(`${indent}  ${hit ? "yes" : "no "}  ${p.toFixed(2)}  ${secs(Date.now() - windowSnap.at).padStart(5)} jev  ${r.name}${span}`);
      if (hit) {
        ui.log(`${indent}section ${split(sectionSnap)}`);
        const settled = await settle({ pdf, section: r.name, page: w.page, p, text: w.text }, `${r.name}${span}`);
        if (settled) return { hit: settled, tried, rejected };
        if (rejected.length >= maxAnswers) return { tried, rejected };
      }
    }
    if (ws.length > 1) ui.log(`${indent}  section ${split(sectionSnap)}  ${r.name}`);
  }
  return { tried, rejected };
}
