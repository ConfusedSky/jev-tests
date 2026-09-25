/**
 * The tools' flags as the UI offers them, and the command line a set of
 * choices makes. Imported by the browser, so it names the CLI's kinds and
 * cache models itself; options.test.ts holds it to cli.ts and cache.ts.
 */
import { feed, quote } from "./sources";

export type Tool = "jevsec" | "jevfind" | "jevgrep";

export const KINDS = ["count", "number", "truth", "passage", "table"] as const;
export type Kind = (typeof KINDS)[number];
export const CACHES = ["qwen3-4b", "qwen3-0.6b", "3-small", "off"] as const;

/** Each cache model's bars, as cache.ts sets them: an earlier ranking is reused when the whole question scores `whole` against it, or its subject `subject`. */
export const CACHE_BARS: Record<Exclude<(typeof CACHES)[number], "off">, { whole: number; subject: number }> = {
  "qwen3-4b": { whole: 0.53, subject: 0.8 },
  "qwen3-0.6b": { whole: 0.6, subject: 0.86 },
  "3-small": { whole: 0.56, subject: 0.7 },
};

/** How far above its bar a question's match still counts as weak. */
const WEAK = 0.1;

/** Whether a ranking reused from the cache was matched on a question only weakly like this one: within WEAK of the bar, or under it with the subject carrying the match. */
export const weakMatch = (model: Options["cache"], whole: number) => model !== "off" && whole < CACHE_BARS[model].whole + WEAK;

export type Options = {
  kind: "auto" | Kind;
  hits: number;
  cache: (typeof CACHES)[number];
  across: "auto" | "on" | "off";
  threshold: number;
  answerFloor: number;
  search: boolean;
  toc: boolean;
  wholeWindows: boolean;
  max: number;
  maxAnswers: number;
  titleFloor: number;
  fileFloor: number;
  maxFiles: number;
  chars: number;
  batch: number;
  model: string;
  top: number;
  nameFloor: number;
};

export const DEFAULTS: Options = {
  kind: "auto",
  hits: 1,
  cache: "qwen3-4b",
  across: "auto",
  threshold: 0.7,
  answerFloor: 0.7,
  search: true,
  toc: true,
  wholeWindows: false,
  max: 12,
  maxAnswers: 5,
  titleFloor: 1,
  fileFloor: 1.5,
  maxFiles: 5,
  chars: 48000,
  batch: 40,
  model: "",
  top: 0,
  nameFloor: 1.5,
};

type Common = { key: keyof Options; label: string; help: string; tools: Tool[]; advanced?: boolean };
export type Spec = Common &
  (
    | { type: "number"; min: number; max: number; step: number; flag: string }
    | { type: "select"; values: readonly string[]; flag: (v: string) => string[] }
    | { type: "toggle"; flag: (on: boolean) => string[] }
    | { type: "text"; flag: string; placeholder: string }
  );

const READ: Tool[] = ["jevsec", "jevfind"];
const ALL: Tool[] = ["jevsec", "jevfind", "jevgrep"];

export const SPECS: Spec[] = [
  { key: "kind", label: "Kind", type: "select", values: ["auto", ...KINDS], flag: (v) => ["--kind", v], tools: READ, help: "jev reads the kind off the wording; force one instead" },
  { key: "hits", label: "Passages", type: "number", min: 1, max: 10, step: 1, flag: "-n", tools: READ, help: "keep walking until this many passages pass; passage questions only" },
  { key: "cache", label: "Ranking cache", type: "select", values: CACHES, flag: (v) => ["--cache", v], tools: READ, help: "reuse the ranking of an earlier, similar question; off ranks every book afresh" },
  { key: "across", label: "Table across the shelf", type: "select", values: ["auto", "on", "off"], flag: (v) => [v === "on" ? "--across" : "--no-across"], tools: ["jevfind"], help: "a row per document the question names, a column per question; auto asks jev" },
  { key: "threshold", label: "Page threshold", type: "number", min: 0, max: 1, step: 0.05, flag: "-t", tools: READ, advanced: true, help: "yes-probability a page needs before it is read for the answer" },
  { key: "answerFloor", label: "Answer floor", type: "number", min: 0, max: 1, step: 0.05, flag: "--answer-floor", tools: READ, advanced: true, help: "confidence an answer read off a page must reach" },
  { key: "search", label: "Search the text", type: "toggle", flag: (on) => (on ? [] : ["--no-search"]), tools: READ, advanced: true, help: "rank the pages that mention the question's subject beside the section titles" },
  { key: "toc", label: "Answer from the contents", type: "toggle", flag: (on) => (on ? [] : ["--no-toc"]), tools: READ, advanced: true, help: "let the table of contents alone answer when it can" },
  { key: "wholeWindows", label: "Whole windows", type: "toggle", flag: (on) => (on ? ["--whole-windows"] : []), tools: READ, advanced: true, help: "gate a window of text at a time instead of every page" },
  { key: "max", label: "Max sections", type: "number", min: 1, max: 200, step: 1, flag: "--max", tools: READ, advanced: true, help: "sections read per file, or windows of a book with no outline" },
  { key: "maxAnswers", label: "Max answers", type: "number", min: 1, max: 50, step: 1, flag: "--max-answers", tools: READ, advanced: true, help: "windows read out before settling for the best" },
  { key: "titleFloor", label: "Title floor", type: "number", min: 0, max: 3, step: 0.1, flag: "--title-floor", tools: READ, advanced: true, help: "sections scoring below this are read only while nothing has answered" },
  { key: "fileFloor", label: "File floor", type: "number", min: 0, max: 3, step: 0.1, flag: "--file-floor", tools: ["jevfind"], advanced: true, help: "files scoring below this are opened only while nothing has answered" },
  { key: "maxFiles", label: "Max files", type: "number", min: 1, max: 100, step: 1, flag: "--max-files", tools: ["jevfind"], advanced: true, help: "files opened at most" },
  { key: "chars", label: "Characters per call", type: "number", min: 1000, max: 200000, step: 1000, flag: "--chars", tools: READ, advanced: true, help: "text sent per call" },
  { key: "top", label: "Keep best", type: "number", min: 0, max: 1000, step: 1, flag: "-n", tools: ["jevgrep"], help: "keep only this many names; 0 keeps all" },
  { key: "nameFloor", label: "Score floor", type: "number", min: 0, max: 3, step: 0.1, flag: "-t", tools: ["jevgrep"], help: "minimum score a name needs, 0-3" },
  { key: "batch", label: "Names per call", type: "number", min: 1, max: 500, step: 1, flag: "--batch", tools: ALL, advanced: true, help: "names per ranking call" },
  { key: "model", label: "Model", type: "text", flag: "--model", placeholder: "empty: jev's default", tools: ALL, advanced: true, help: "an OpenRouter slug, or semif for the local backend" },
];

/** The flags that differ from the defaults, in SPECS order. */
export function argsFor(tool: Tool, o: Options): string[] {
  return SPECS.flatMap((s) => {
    const v = o[s.key];
    if (!s.tools.includes(tool) || v === DEFAULTS[s.key]) return [];
    if (s.type === "number") return Number.isFinite(v) ? [s.flag, String(v)] : [];
    if (s.type === "text") return String(v).trim() ? [s.flag, String(v).trim()] : [];
    if (s.type === "toggle") return s.flag(v as boolean);
    return s.flag(String(v));
  });
}

/** Why `tool` cannot run with these options (a number outside its range, or a fraction where a count goes), or undefined. */
export function invalid(tool: Tool, o: Options): string | undefined {
  for (const s of SPECS) {
    const v = o[s.key];
    if (s.type !== "number" || !s.tools.includes(tool)) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < s.min || v > s.max) return `${s.label} must be between ${s.min} and ${s.max}`;
    // A count taken as a fraction, -n 1.5, runs as some other count.
    if (s.step === 1 && !Number.isInteger(v)) return `${s.label} must be a whole number`;
  }
}

/** `v` held within the range of the number option `key`. */
export function clampOption(key: keyof Options, v: number): number {
  const s = SPECS.find((x) => x.key === key);
  return s?.type === "number" ? Math.min(s.max, Math.max(s.min, v)) : v;
}

/** The specs that apply to `tool` and differ from the defaults. */
export const changed = (tool: Tool, o: Options) => SPECS.filter((s) => s.tools.includes(tool) && o[s.key] !== DEFAULTS[s.key]);

/** The command line the run is, as a user would type it in the repo. */
export function commandFor(tool: Tool, o: Options, question: string, target: { pdf?: string; sources?: string[] }): string {
  const cli = ["bun", `${tool}.ts`, ...argsFor(tool, o), ...(tool === "jevsec" ? [target.pdf ?? "BOOK.pdf"] : []), question || "QUESTION"].map(quote).join(" ");
  if (tool === "jevsec") return cli;
  return `${feed(target.sources ?? [])} | ${cli}`;
}
