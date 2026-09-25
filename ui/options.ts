/**
 * The tools' flags as the UI offers them, and the command line a set of
 * choices makes. Imported by the browser, so it names the CLI's kinds and
 * cache models itself; options.test.ts holds it to cli.ts and cache.ts.
 */
export type Tool = "jevsec" | "jevfind" | "jevgrep";

export const KINDS = ["count", "number", "truth", "passage", "table"] as const;
export type Kind = (typeof KINDS)[number];
export const CACHES = ["qwen3-4b", "qwen3-0.6b", "3-small", "off"] as const;

export type Options = {
  kind: "auto" | Kind;
  hits: number;
  cache: (typeof CACHES)[number];
  highlight: boolean;
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
  highlight: true,
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
  { key: "highlight", label: "Highlight the answer", type: "toggle", flag: (on) => (on ? [] : ["--no-highlight"]), tools: READ, help: "mark the answer in a copy of the PDF, which the page preview shows" },
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
  { key: "model", label: "Model", type: "text", flag: "--model", placeholder: "~typesafe/jev-latest", tools: ALL, advanced: true, help: "jev's slug on OpenRouter, or semif for the local backend" },
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

/** Why `tool` cannot run with these options (a number outside its range), or undefined. */
export function invalid(tool: Tool, o: Options): string | undefined {
  for (const s of SPECS) {
    const v = o[s.key];
    if (s.type !== "number" || !s.tools.includes(tool)) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < s.min || v > s.max) return `${s.label} must be between ${s.min} and ${s.max}`;
  }
}

/** The specs that apply to `tool` and differ from the defaults. */
export const changed = (tool: Tool, o: Options) => SPECS.filter((s) => s.tools.includes(tool) && o[s.key] !== DEFAULTS[s.key]);

const quote = (s: string) => (/^[\w./:@%+=,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** The command line the run is, as a user would type it in the repo. */
export function commandFor(tool: Tool, o: Options, question: string, target: { pdf?: string; folders?: string[] }): string {
  const cli = ["bun", `${tool}.ts`, ...argsFor(tool, o), ...(tool === "jevsec" ? [target.pdf ?? "BOOK.pdf"] : []), question || "QUESTION"].map(quote).join(" ");
  if (tool === "jevsec") return cli;
  const dirs = target.folders?.length ? target.folders.map(quote).join(" ") : ".";
  return `find ${dirs} -iname '*.pdf' | ${cli}`;
}
