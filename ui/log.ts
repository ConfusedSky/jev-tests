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
 */
export const isTotal = (l: Line) => l.depth === 0 && l.text.startsWith("total ");

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
  /** -n asked for this many passages of a question that has one answer. */
  onlyOne?: number;
};

export function factsOf(lines: Line[]): Facts {
  const f: Facts = {};
  let m: RegExpExecArray | null;
  for (const { text, depth } of lines) {
    // A table across the shelf reads each cell's question too, a level down; the facts are the question's own.
    if (depth === 0 && (m = /^question (looks like|treated as) an? (\w+) question/.exec(text))) [f.kind, f.forced] = [m[2], m[1] === "treated as"];
    else if (depth === 0 && (m = /^asks for (.+)$/.exec(text))) f.asks = m[1];
    else if (depth === 0 && (m = /^counts (.+)$/.exec(text))) f.counts = m[1];
    else if (depth === 0 && (m = /^searches for (.+)$/.exec(text))) f.searches = m[1];
    else if (depth === 0 && (m = /^-n (\d+) applies to passage questions only/.exec(text))) f.onlyOne = Number(m[1]);
    else if ((m = /^ranked from cache in .*?: "(.+)" \((.+)\)$/.exec(text))) f.cache = f.cache ? { ...f.cache, count: f.cache.count + 1 } : { question: m[1]!, score: m[2]!, count: 1 };
    else if ((m = /^--\s+no outline and no extractable text\s+(.+)$/.exec(text))) f.noText = [...(f.noText ?? []), m[1]!];
    else if ((m = /^embedding (\d+) pages of (.+), once/.exec(text))) f.embedding = `${m[1]} pages of ${m[2]}`;
    else if ((m = /^rows name documents \(p=[\d.]+\): (.+?); asks (.+?)  in /.exec(text))) f.across = { rows: m[1]!, columns: m[2]! };
    else if ((m = /^total .*, (\d+) files opened, (\d+) windows read/.exec(text))) [f.files, f.windows] = [Number(m[1]), Number(m[2])];
    if (/^section .*…$/.test(text)) f.sections = (f.sections ?? 0) + 1;
  }
  return f;
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
