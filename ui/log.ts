/**
 * Reading the tools' stderr log: a line's depth, verdict and cost, the tree
 * its indentation makes, what jev read off the question, and the spend so
 * far while a run is still going.
 */
export type Cost = { in: number; out: number; dollars: number };
export type Line = { t: number; depth: number; text: string; header: boolean; verb?: string; cost?: Cost; secs?: number; message: boolean };

/** The verdict or step a line opens with; "no" only before a probability, so "no outline: …" is not a verdict. */
const verbOf = (text: string) =>
  /^(take|keep|drop|toc)\s{2}/.exec(text)?.[1] ?? /^(yes|no)\s+\d\.\d\d/.exec(text)?.[1] ?? /^(excerpt|section|file|total|ranked|gated)\b/.exec(text)?.[1] ?? (/^--\s/.test(text) ? "--" : undefined);
const COST = /([\d,]+) tokens in, ([\d,]+) out, \$([\d.]+)/;
const num = (s: string) => Number(s.replace(/,/g, ""));

export function parseLine(raw: string, t = 0): Line {
  const text = raw.trimStart();
  const c = COST.exec(text);
  const secs = /(\d+(?:\.\d+)?)s \(jev /.exec(text);
  return {
    t,
    depth: Math.floor((raw.length - text.length) / 2),
    text,
    header: text.endsWith("…"),
    verb: verbOf(text),
    cost: c ? { in: num(c[1]!), out: num(c[2]!), dollars: Number(c[3]) } : undefined,
    secs: secs ? Number(secs[1]) : undefined,
    message: /^(jev|jevsec|jevfind|jevgrep): /.test(text),
  };
}

/** A header ending in "…" holds the deeper lines under it and, once they end, the sum at its own depth. */
export type Node = { line: Line; index: number; children: Node[]; sum?: Line };

export function tree(lines: Line[]): Node[] {
  const root: Node[] = [];
  const stack: Node[] = [];
  lines.forEach((line, index) => {
    while (stack.length && stack[stack.length - 1]!.line.depth >= line.depth) stack.pop();
    const siblings = stack.length ? stack[stack.length - 1]!.children : root;
    const prev = siblings[siblings.length - 1];
    if (prev && prev.line.header && !prev.sum && prev.children.length && prev.line.depth === line.depth && line.cost && !line.header) {
      prev.sum = line;
      return;
    }
    const node: Node = { line, index, children: [] };
    siblings.push(node);
    stack.push(node);
  });
  return root;
}

/**
 * Tokens spent so far. A cost line sums the deeper cost lines since the last
 * line at its depth or shallower, so it replaces them; `total` is the whole.
 * A tool's own closing message counts since the start too, and older logs
 * end on it without a `total`.
 */
export const isTotal = (l: Line) => l.depth === 0 && (l.text.startsWith("total ") || (l.message && !!l.cost));

export function spendOf(lines: Line[]): Cost {
  const counted: { depth: number; cost: Cost }[] = [];
  for (const l of lines) {
    if (!l.cost) continue;
    if (isTotal(l)) return l.cost;
    while (counted.length && counted[counted.length - 1]!.depth > l.depth) counted.pop();
    counted.push({ depth: l.depth, cost: l.cost });
  }
  return counted.reduce((a, { cost }) => ({ in: a.in + cost.in, out: a.out + cost.out, dollars: a.dollars + cost.dollars }), { in: 0, out: 0, dollars: 0 });
}

/** A line without its time-and-tokens clause, which the UI shows on its own. */
export const withoutCost = (text: string) =>
  text
    .replace(/\s+in \d+(\.\d+)?s \(jev [^)]*\)/, "")
    .replace(/\s\d+(\.\d+)?s \(jev [^)]*\),?/, "")
    .replace(/\s{2,}/g, "  ")
    .trim();

/** What the log says jev read off the question and how the run went about answering it. */
export type Facts = {
  kind?: string;
  forced?: boolean;
  counts?: string;
  asks?: string;
  searches?: string;
  /** The first ranking taken from the cache, and how many were. */
  cache?: { question: string; score: string; count: number };
  /** PDFs with neither an outline nor a text layer, which nothing can be read off. */
  noText?: string[];
  embedding?: string;
  across?: { rows: string; columns: string };
  files?: number;
  windows?: number;
  sections?: number;
  /** Excerpt pages the walk gated, each read on its own apart from the sections. */
  excerpts?: number;
  /** -n asked for this many passages of a question that has one answer. */
  onlyOne?: number;
  /** Answers the table of contents gave, with the section each named; a hit matching one was never read off a page. */
  toc?: { text: string; section: string }[];
  /** Sections one file's walk took up, the most of any file; --max stops a walk at that many. */
  mostSections?: number;
  /** A book without an outline: windows scanned, of those left after the excerpts. */
  scan?: { read: number; of: number };
  /** Sections under the title floor, and files under the file floor, read only while nothing has answered. */
  titleBelow?: number;
  filesBelow?: number;
};

/** A section the walk passed over, logged a level under the ones it took up; both count against --max. */
const SKIPPED = /^--\s+.*(already read$|already counted under |p\.\d+-\d+\s+no extractable text$)/;

export function factsOf(lines: Line[]): Facts {
  const f: Facts = {};
  let m: RegExpExecArray | null;
  let attempts = 0;
  for (const { text, depth, header } of lines) {
    // A table across the shelf reads each cell's question too, a level down; the facts are the question's own.
    if (depth === 0 && (m = /^question (looks like|treated as) an? (\w+) question/.exec(text))) [f.kind, f.forced] = [m[2], m[1] === "treated as"];
    else if (depth === 0 && (m = /^asks for (.+)$/.exec(text))) f.asks = m[1];
    else if (depth === 0 && (m = /^counts (.+)$/.exec(text))) f.counts = m[1];
    else if (depth === 0 && (m = /^searches for (.+)$/.exec(text))) f.searches = m[1];
    else if (depth === 0 && (m = /^-n (\d+) applies to passage questions only/.exec(text))) f.onlyOne = Number(m[1]);
    // A shelf walk ranks each file a level down; a cell's walk, two down, is the cell's own.
    else if (depth <= 1 && (m = /^ranked from cache in .*?: "(.+)" \((.+)\)$/.exec(text))) f.cache = f.cache ? { ...f.cache, count: f.cache.count + 1 } : { question: m[1]!, score: m[2]!, count: 1 };
    else if (depth <= 1 && (m = /^ranked .* sections and .* above title floor [\d.]+ \((\d+) below\)/.exec(text))) f.titleBelow = Math.max(f.titleBelow ?? 0, Number(m[1]));
    else if (depth === 0 && (m = /^ranked \d+ paths .* above file floor [\d.]+ \((\d+) below\)/.exec(text))) f.filesBelow = Number(m[1]);
    else if ((m = /^toc\s+(.+?) \(p=[\d.]+\)\s{2}(.+?)\s{2}in \d/.exec(text))) f.toc = [...(f.toc ?? []), { text: m[1]!, section: m[2]! }];
    else if ((m = /^no outline: scanning (\d+) of (\d+) windows/.exec(text))) f.scan = { read: Number(m[1]), of: Number(m[2]) };
    else if ((m = /^--\s+no outline and no extractable text\s+(.+)$/.exec(text))) f.noText = [...(f.noText ?? []), m[1]!];
    else if ((m = /^embedding (\d+) pages of (.+), once/.exec(text))) f.embedding = `${m[1]} pages of ${m[2]}`;
    else if ((m = /^rows name documents \(p=[\d.]+\): (.+?); asks (.+?)  in /.exec(text))) f.across = { rows: m[1]!, columns: m[2]! };
    else if ((m = /^total .*, (\d+) files opened, (\d+) windows read/.exec(text))) [f.files, f.windows] = [Number(m[1]), Number(m[2])];
    if (/^section .*…$/.test(text)) f.sections = (f.sections ?? 0) + 1;
    if (/^excerpt\s+(yes|no)\s+\d/.test(text)) f.excerpts = (f.excerpts ?? 0) + 1;
    // A shelf walk opens each file under a line of its score and name.
    if (depth === 0 && header && /^\d\.\d\d\s{2}/.test(text)) attempts = 0;
    if ((depth <= 1 && /^section .*…$/.test(text)) || (depth <= 2 && SKIPPED.test(text))) f.mostSections = Math.max(f.mostSections ?? 0, ++attempts);
  }
  return f;
}

/** One thing the walk read: a section, an excerpt page, a window of a PDF without an outline, or the table of contents. */
export type Read = { kind: "section" | "excerpt" | "window" | "contents"; name: string; p?: number; verdict?: "take" | "keep" | "drop"; answer?: string; page?: number };
/** A PDF the walk opened: its score among the paths, how its sections were ranked, and what was read in it. */
export type FileWalk = { path?: string; score?: number; ranked?: string; reads: Read[] };
export type Walk = { paths?: { ranked: number; above?: number; floor?: string }; names?: number; files: FileWalk[] };

const STRENGTH = { drop: 0, keep: 1, take: 2 } as const;

/** What the walk read, file by file, read off the log as it stands, so a live run's grows as it goes. */
export function walkOf(lines: Line[]): Walk {
  const w: Walk = { files: [] };
  let file: FileWalk | undefined;
  let cur: Read | undefined;
  let scan: number | undefined;
  const here = () => {
    if (!file) w.files.push((file = { reads: [] }));
    return file;
  };
  const add = (r: Read) => {
    here().reads.push(r);
    return (cur = r);
  };
  let m: RegExpExecArray | null;
  for (const { text, depth, header } of lines) {
    if (scan !== undefined && depth <= scan) scan = undefined;
    if ((m = /^ranked (\d+) paths/.exec(text))) {
      const above = /(\d+) above file floor ([\d.]+)/.exec(text);
      w.paths = { ranked: Number(m[1]), above: above ? Number(above[1]) : undefined, floor: above?.[2] };
    } else if ((m = /^ranked (\d+) names/.exec(text))) w.names = Number(m[1]);
    else if (depth === 0 && header && (m = /^(\d\.\d\d)\s{2}(.+)…$/.exec(text))) {
      w.files.push((file = { path: m[2], score: Number(m[1]), reads: [] }));
      cur = undefined;
    } else if ((m = /^ranked (\d+) sections and (\d+) excerpts/.exec(text))) here().ranked = `${m[1]} section${m[1] === "1" ? "" : "s"}${m[2] !== "0" ? ` and ${m[2]} excerpt${m[2] === "1" ? "" : "s"}` : ""}`;
    else if (/^ranked from cache/.test(text)) here().ranked = "from the cache";
    else if ((m = /^section (.+?)\s{2}p\.(\d+)-(\d+)…$/.exec(text))) add({ kind: "section", name: `${m[1]} p.${m[2] === m[3] ? m[2] : `${m[2]}-${m[3]}`}` });
    else if ((m = /^excerpt\s+(yes|no)\s+(\d\.\d\d)\s+(.+?)(?: \(excerpt\))?…?$/.exec(text))) add({ kind: "excerpt", name: m[3]!.replace(/^(p\.\d+) \1$/, "$1"), p: Number(m[2]) });
    else if (/^no outline: scanning/.test(text)) scan = depth;
    else if ((m = /^(yes|no)\s+(\d\.\d\d)\s+(?:[\d.]+s jev\s+)?(.+)$/.exec(text))) {
      const p = Number(m[2]);
      if (scan !== undefined || cur?.kind !== "section") add({ kind: "window", name: m[3]!, p });
      else cur.p = Math.max(cur.p ?? 0, p);
    } else if ((m = /^(take|keep|drop)\s+(.+) \(p=(\d\.\d\d)\)\s{2}(.+)$/.exec(text))) {
      const verdict = m[1] as keyof typeof STRENGTH;
      const r = cur ?? add({ kind: "window", name: m[4]! });
      if (r.verdict && STRENGTH[r.verdict] > STRENGTH[verdict]) continue;
      const page = [...m[4]!.matchAll(/p\.(\d+)/g)].pop()?.[1];
      Object.assign(r, { verdict, answer: m[2], page: page ? Number(page) : r.page });
    } else if ((m = /^toc\s+(.+?) \(p=(\d\.\d\d)\)\s{2}(.+?)\s{2}in /.exec(text))) add({ kind: "contents", name: m[3]!, p: Number(m[2]), verdict: "take", answer: m[1] });
  }
  return w;
}

const count = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;
const listed = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The walk in a line of steps: what was ranked, what was opened, what was read, and what was taken. */
export function flowOf(w: Walk): string[] {
  const out: string[] = [];
  if (w.names !== undefined) out.push(`ranked ${w.names} names`);
  if (w.paths) out.push(`ranked ${w.paths.ranked} paths`, `opened ${w.files.length} of ${w.paths.ranked}${w.paths.above !== undefined ? ` (${w.paths.above} above the file floor ${w.paths.floor})` : ""}`);
  else if (w.files[0]?.ranked) out.push(`ranked ${w.files[0].ranked}`);
  const reads = w.files.flatMap((f) => f.reads);
  const n = (k: Read["kind"]) => reads.filter((r) => r.kind === k).length;
  const parts = [n("contents") ? "the contents" : "", n("section") ? count(n("section"), "section") : "", n("excerpt") ? count(n("excerpt"), "excerpt page") : "", n("window") ? count(n("window"), "window") : ""].filter(Boolean);
  if (parts.length) out.push(`read ${listed(parts)}`);
  const took = w.files.flatMap((f) => f.reads.filter((r) => r.verdict === "take").map((r) => ({ f, r })));
  const where = ({ f, r }: (typeof took)[number]) => `${w.files.length > 1 && f.path ? `${f.path.split("/").pop()} ` : ""}${r.kind === "contents" ? "the contents" : r.page ? `p.${r.page}` : r.name}`;
  if (took.length) out.push(`took ${took.slice(0, 3).map(where).join(", ")}${took.length > 3 ? ` and ${took.length - 3} more` : ""}`);
  else if (reads.length) out.push("took nothing");
  return out;
}

/** Where each column of a table built to order was read from, as the step that fills its cells logs it: a column's name to its source. */
export function columnsOf(lines: Line[]): Record<string, string> {
  const out: Record<string, string> = {};
  let under: number | undefined;
  for (const { text, depth } of lines) {
    if (under !== undefined && depth <= under) under = undefined;
    if (/^cells: filling \d+…$/.test(text)) under = depth;
    else if (under !== undefined && depth === under + 1) {
      const m = /^(.+?): (".+" p\.\d+|each entry's label|the rows' own cells|not in a table; from the rows' own cells)$/.exec(text);
      if (m) out[m[1]!] = m[2]!;
    }
  }
  return out;
}

/** A measure of how far a live run has come: `done` of at most `of`. */
export type Gauge = { label: string; done: number; of: number };

/**
 * How far a live run has come, where the log can say: the files a shelf
 * walk may open, the sections a file may read before --max stops it, and
 * the batch or window of the step it is on. A walk that finds its answer
 * stops short of any of them.
 */
export function gaugesOf(lines: Line[], trying: string | undefined, limits: { max: number; maxFiles?: number }): Gauge[] {
  const w = walkOf(lines);
  const out: Gauge[] = [];
  if (w.paths && limits.maxFiles) out.push({ label: "files opened", done: w.files.length, of: Math.min(limits.maxFiles, w.paths.ranked) });
  const file = w.files[w.files.length - 1];
  const read = file?.reads.filter((r) => r.kind === "section" || r.kind === "window").length ?? 0;
  if (file?.ranked !== undefined || read) out.push({ label: w.paths ? "sections read in this file" : "sections read", done: Math.min(read, limits.max), of: limits.max });
  const step = trying ? /\((batch|window) (\d+)\/(\d+)\)/.exec(trying) : null;
  if (step) out.push({ label: `${step[1]} ${step[2]} of ${step[3]} in this step`, done: Number(step[2]) - 1, of: Number(step[3]) });
  return out;
}

/** A stack frame, a line of the code frame around a throw, or the runtime's banner: what a crash prints around its error. */
const FRAME = /^\s*(at\s|\^+\s*$|\d+\s*\|)|^Bun v\d/;

/**
 * Why a tool stopped, as far as its last lines say: an uncaught error from
 * its own line on (its message can run over several), else the last `n`
 * lines, never the frames around it.
 */
export function errorText(lines: string[], n = 3): string {
  const said = lines.filter((l) => l.trim() && !FRAME.test(l));
  const bun = said.findLastIndex((l) => /^error: /.test(l.trim()));
  const at = bun >= 0 ? bun : said.findLastIndex((l) => /^\w*Error: /.test(l.trim()));
  return (at >= 0 ? said.slice(at, at + 6) : said.slice(-n)).join("\n");
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]|\u001b\]8;;[^\u0007]*\u0007/g;

/**
 * Splits stderr as far as it has come into log lines and progress lines, the
 * latter ended by \r (see makeUi); returns what is left of an unended line.
 */
export function drain(buf: string, emit: (e: { type: "log" | "trying"; line: string }) => void): string {
  let at = 0;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c !== "\n" && c !== "\r") continue;
    const text = buf.slice(at, i).replace(ANSI, "");
    at = i + 1;
    if (c === "\r") emit({ type: "trying", line: text.replace(/^\s*…\s*/, "") });
    else if (text.trim()) emit({ type: "log", line: text.trimEnd() });
  }
  return buf.slice(at);
}
