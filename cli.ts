import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { answerFrom, answerFromOutline, claimVerdict, countAcross, KINDS, readPassage, readQuestion, type Answer, type Judged, type Kind, type Reading } from "./answer";
import { CACHE_MODELS, embedder, rankingCache as makeRankingCache, unready, type CacheModel } from "./cache";
import { lone, pageParagraphs, type Para, type Row } from "./layout";
import { cacheDir, GATE, highlighted, link, openAt, pageCount, pageUrl, type Hit, type Outcome, type SearchOpts, type Section, type Ui } from "./pdf";
import { DEFAULT_MODEL, snapshot, split, spentSince, timed, type Snapshot, type Spent } from "./shared";
import { terms } from "./search";

/** A flag's handler; `next` consumes the following argument, `fail` rejects its value. */
export type Flags<O> = Record<string, (o: O, next: () => string, fail: (why: string) => never) => void>;

/**
 * Applies `flags` (keyed "-x|--long") to `o`; returns the positionals. `-h`
 * calls `usage(0)`. An unrecognized flag is an error rather than a positional:
 * silently folding `--typo` into the question asked a different question.
 */
export function parseFlags<O>(argv: string[], o: O, flags: Flags<O>, usage: (code: number) => never): string[] {
  const byName = new Map(Object.entries(flags).flatMap(([names, set]) => names.split("|").map((n) => [n, set])));
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const set = byName.get(a);
    if (set) {
      set(o, () => argv[++i] ?? "", (why) => {
        console.error(`${a} ${why}`);
        usage(1);
      });
    } else if (a === "-h" || a === "--help") usage(0);
    else if (a.startsWith("-") && a !== "-") {
      console.error(`unknown flag: ${a}`);
      usage(1);
    } else rest.push(a);
  }
  return rest;
}

type NumKeys<O> = { [K in keyof O]: O[K] extends number ? K : never }[keyof O];
export const num =
  <O extends object>(key: NumKeys<O>) =>
  (o: O, next: () => string, fail: (why: string) => never) => {
    const v = Number(next());
    // Without this, --top abc becomes NaN and slice(0, NaN) prints nothing.
    if (!Number.isFinite(v)) fail("expects a number");
    Object.assign(o, { [key]: v });
  };

/** The cache of rankings for one question, kept with the text cache. */
const rankingCacheFor = (m: CacheModel, question: string, subject: string[]) => makeRankingCache(m, embedder(m), `${cacheDir()}/rankings`, question, subject);

/** Pages a passage may grow onto past the end of the section it was found in. */
const PASSAGE_REACH = 2;

/** Options every PDF-reading tool shares; jevfind adds its file-level floors on top. */
export type ReadOpts = SearchOpts & {
  model: string;
  quiet: boolean;
  open: boolean;
  highlight: boolean;
  answerFloor: number;
  noToc: boolean;
  maxAnswers: number;
  perPage: boolean;
  hits: number;
  /** Search the text for the question's subject and rank the pages found beside the titles. */
  search: boolean;
  kind?: Kind;
  /** Piped, a table's rows as tab-separated lines under their heads instead of JSON. */
  tsv: boolean;
  /** The outcome on stdout as one JsonReport instead of text. */
  json: boolean;
  /** What jev read off the question, kept for a table to build its searches from. */
  reading?: Reading;
  /** The embedding model whose cache of rankings is looked in first (see cache.ts), or "off". */
  cache: string;
};

export const readDefaults = (): ReadOpts => ({
  question: "",
  threshold: 0.7,
  titleFloor: 1.0,
  max: 12,
  chars: 48000,
  batch: 40,
  model: DEFAULT_MODEL,
  quiet: false,
  open: false,
  highlight: true,
  answerFloor: 0.7,
  noToc: false,
  maxAnswers: 5,
  perPage: true,
  hits: 1,
  search: true,
  tsv: false,
  json: false,
  cache: "qwen3-4b",
});

export const readFlags = (): Flags<ReadOpts> => ({
  "-t|--threshold": num("threshold"),
  "-n|--hits": num("hits"),
  "--title-floor": num("titleFloor"),
  "--max": num("max"),
  "--chars": num("chars"),
  "--batch": num("batch"),
  "--answer-floor": num("answerFloor"),
  "--max-answers": num("maxAnswers"),
  "--model": (o, next) => (o.model = next()),
  "-q|--quiet": (o) => (o.quiet = true),
  "--open": (o) => (o.open = true),
  // The default; still taken, so a command line written before is not refused.
  "--highlight": (o) => (o.highlight = true),
  "--no-highlight": (o) => (o.highlight = false),
  "--whole-windows": (o) => (o.perPage = false),
  "--no-toc": (o) => (o.noToc = true),
  "--no-search": (o) => (o.search = false),
  "--tsv": (o) => (o.tsv = true),
  "--json": (o) => (o.json = true),
  "--cache": (o, next, fail) => {
    const m = next();
    if (m !== "off" && !CACHE_MODELS[m]) fail(`must be off or one of ${Object.keys(CACHE_MODELS).join(", ")}`);
    o.cache = m;
  },
  "--kind": (o, next, fail) => {
    const k = next();
    if (!KINDS.some((x) => x === k)) fail(`must be one of ${KINDS.join(", ")}`);
    o.kind = k as Kind;
  },
});

export const READ_USAGE = `  -t, --threshold P    yes-probability needed to stop, 0-1 (default 0.7)
  -n, --hits N         keep walking until N passages have passed (passage questions only)
      --title-floor F  read sections scoring below F on title only while nothing has
                       answered, 0-3 (default 1.0)
      --max N          read at most N sections per file, or N windows of a book with no outline (default 12)
      --chars N        characters of text per call (default 48000)
      --whole-windows  gate a window of text at a time instead of every page
      --batch N        names per ranking call (default 40)
      --model SLUG     default ~typesafe/jev-latest, or $JEVGREP_MODEL
  -q, --quiet          only print the hit
      --open           open the hit in your PDF viewer, at the page
      --no-highlight   link to the PDF itself, not a copy with the answer highlighted
      --answer-floor P confidence an answer read off a page must reach, 0-1 (default 0.7)
      --max-answers N  windows to read out before settling for the best (default 5)
      --no-toc         never answer from the table of contents alone
      --no-search      rank outline titles only, without searching the text
      --tsv            piped, print a table's rows tab-separated under their heads, not as JSON,
                       and the link on stderr
      --json           print the outcome on stdout as one JSON document (JsonReport in cli.ts)
      --kind K         force count, number, truth, passage or table instead of asking jev
      --cache MODEL    reuse the ranking of an earlier, similar question, matched by
                       qwen3-4b (default, Ollama), qwen3-0.6b (Ollama) or 3-small
                       (OpenRouter); off ranks every book afresh`;

/**
 * Wires the answer layer into a search: a count, number or statement has a
 * value to be confident about, and a passage has the stretch of the page
 * that answers.
 */
/**
 * Stops the run, before anything is spent, when the ranking cache cannot
 * run: without it every book is ranked afresh, which costs real money, so
 * that is asked for with --cache off rather than done quietly.
 */
let cacheChecked: Promise<void> | undefined;
export function checkCache(model: string): Promise<void> {
  const m = CACHE_MODELS[model];
  if (!m) return Promise.resolve();
  return (cacheChecked ??= unready(m).then((why) => {
    if (!why) return;
    console.error(`jev: ${why}`);
    process.exit(2);
  }));
}

export async function answerLayer<O extends ReadOpts>(client: TypeSafeClient, o: O, ui: Ui, preset?: Reading): Promise<O> {
  await checkCache(o.cache);
  // Kind and quantities come off the wording alone, so one call reads both.
  const asked = snapshot();
  const read = preset ?? (await readQuestion(client, o.question));
  const kind = o.kind ?? read.kind;
  // Reading the question is a call of its own, so it says what it spent.
  ui.log(`${o.kind ? `question treated as a ${kind} question` : `question looks like a ${kind} question`}  in ${split(asked)}`);
  // A count, number or statement has one answer; only a passage question has
  // several places worth reading. The kind is known only once the reading is
  // paid for, so a stray -n costs a note, not the run.
  const hits = kind === "passage" ? o.hits : 1;
  if (hits < o.hits) ui.log(`-n ${o.hits} applies to passage questions only; one ${kind} answer`);
  // "the cost, weight and damage rating of a combat rifle" is three figures off one page.
  const wanted = kind === "number" ? read.quantities : [];
  if (wanted.length > 1) ui.log(`asks for ${wanted.join(", ")}`);
  if (kind === "count" && read.counted) ui.log(`counts ${read.counted}`);
  const found = o.search ? terms(o.question, read.subject, read.game) : undefined;
  if (found && read.subject.length) ui.log(`searches for ${read.subject.join(", ")}${read.game.length ? ` (not ${read.game.join(", ")})` : ""}`);
  const fromOutline = o.noToc
    ? undefined
    : (sections: Section[]) =>
        answerFromOutline(client, kind, o.question, sections, o.answerFloor, read.counted);
  // "not stated" is a refusal, not an answer, so it never settles a walk
  // however confident the model is that it cannot say; for a passage it
  // means no sentence of the page was part of the answer.
  const judge = (a: Answer): Judged => ({
    ...a,
    verdict: a.text === "not stated" ? "drop" : a.p >= o.answerFloor ? "take" : "keep",
  });
  // A passage is read off the window's pages as mutool lays them out,
  // columns and weights and all, not the -layout text the walk gates on;
  // see layout.ts. Under --whole-windows a window spans pages.
  const verify: SearchOpts["verify"] =
    kind === "passage" || kind === "table"
      ? async (section, page, _text, pdf, end, _nouls, last) => {
          const range = Array.from({ length: end - page + 1 }, (_, i) => page + i);
          const paras = (await timed("extract", () => Promise.all(range.map((p) => pageParagraphs(pdf, p))))).flat();
          // The passage may run on a page at a time through the rest of its
          // section, and PASSAGE_REACH pages past it: a list like Fallout's
          // skills (p.46-49) can outrun a fixed reach from its first page.
          let after = end + 1;
          const upTo = Math.min(await pageCount(pdf), Math.max(end, last) + PASSAGE_REACH);
          const more = () => (after > upTo ? Promise.resolve([]) : timed("extract", () => pageParagraphs(pdf, after++)));
          return judge(await readPassage(client, o.question, section, paras, more, read.quantities));
        }
      : kind === "truth"
        ? // The gate asked the statement's three nouls of the page; no second call.
          async (_section, _page, text, _pdf, _end, nouls) => judge(claimVerdict(o.question, text, nouls))
        : kind === "number"
          ? // A figure is read off the page as laid out, its tables as records: a
            // value beside its column head, not a number loose on a line.
            async (section, page, _text, pdf, end) => {
              const range = Array.from({ length: end - page + 1 }, (_, i) => page + i);
              const paras = (await timed("extract", () => Promise.all(range.map((p) => pageParagraphs(pdf, p))))).flat();
              const text = paras.map((p) => p.text).join("\n");
              return judge(await answerFrom(client, kind, o.question, section, text, read, { pdf, page, end, paras }));
            }
          : async (section, page, text, pdf, end) => judge(await answerFrom(client, kind, o.question, section, text, read, { pdf, page, end }));
  const across: SearchOpts["countAcross"] =
    kind !== "count"
      ? undefined
      : async (section, windows, pdf) =>
          judge(
            await countAcross(
              client,
              o.question,
              section,
              windows.map((w) => ({ ...w, pdf })),
              read.counted,
              o.answerFloor,
              (page, part, counted, running) =>
                ui.log(
                  `    ${counted ? "+" : "?"}${part.text.padStart(3)} (p=${part.p.toFixed(2)})  p.${page}  ` +
                    (counted ? `running ${running}` : "unsure, left out"),
                ),
            ),
          );
  const gate = kind === "count" ? GATE.list : kind === "truth" ? GATE.claim : GATE.answer;
  const m = CACHE_MODELS[o.cache];
  const rankingCache = m && rankingCacheFor(m, o.question, read.subject);
  return { ...o, hits, kind, verify, fromOutline, countAcross: across, gate, terms: found, reading: read, rankingCache };
}

export const hitLine = (h: { pdf: string; page: number; section: string; p: number }) =>
  `${link(h.pdf, h.page)}  ${h.section}  (found p=${h.p.toFixed(2)})`;

/**
 * A passage for the terminal: headings and bold runs in bold, italics in
 * italics, paragraphs wrapped to the window and set apart, a table's rows
 * as a grid, all indented. Piped, it is plain text, a paragraph or a row's
 * JSON a line, so it stays greppable.
 */
export function renderPassage(paras: Para[], width: number | undefined, styled: boolean, tsv = false): string {
  const indent = "  ";
  const window = (width && width >= 40 ? width : 80) - indent.length;
  // Prose wraps at a readable measure; a table takes the whole window.
  const cols = Math.min(window, 100 - indent.length);
  const code = (s: string) => (s === "B" ? "\u001b[1;3m" : s === "b" ? "\u001b[1m" : s === "i" ? "\u001b[3m" : "\u001b[0m");
  const styleLine = (text: string, style: string) => {
    if (!styled) return text;
    let out = "";
    let cur = " ";
    for (let i = 0; i < text.length; i++) {
      const s = style[i] ?? " ";
      if (s !== cur) {
        out += code(s);
        cur = s;
      }
      out += text[i];
    }
    return cur === " " ? out : `${out}\u001b[0m`;
  };
  const renderPara = (p: Para) => {
    if (p.heading) return indent + (styled ? `\u001b[1m${p.text}\u001b[0m` : p.text);
    if (!styled) return indent + p.text;
    // Each character's weight goes with it onto its line.
    return wrap(p.text, cols).map(([a, b]) => indent + styleLine(p.text.slice(a, b), p.style.slice(a, b))).join("\n");
  };
  const blocks: string[] = [];
  for (let i = 0; i < paras.length; i++) {
    const t = paras[i]!.table;
    if ((styled || tsv) && t) {
      const key = t.heads.join("\t");
      const rows = [t];
      while (paras[i + 1]?.table?.heads.join("\t") === key) rows.push(paras[++i]!.table!);
      blocks.push(styled ? renderRows(rows, window).map((l) => (l && indent + l)).join("\n") : tsvRows(rows).join("\n"));
    } else blocks.push(renderPara(paras[i]!));
  }
  return blocks.join(styled ? "\n\n" : "\n");
}

/**
 * Rows under the same heads as a grid, a column as wide as its widest cell
 * and the heads above in bold; a column no printed row fills is left out,
 * and a row of one cell spans the grid. Too wide for the window, each row
 * prints a head and its cell a line instead.
 */
export function renderRows(rows: Row[], cols: number): string[] {
  const bold = (s: string) => `\u001b[1m${s}\u001b[0m`;
  const lines = (text: string, cols: number) => wrap(text, cols).map(([a, b]) => text.slice(a, b));
  const only = (r: Row) => lines(r.cells.find(Boolean)!, cols);
  const cell = (r: Row, i: number) => r.cells[i] ?? "";
  const keep = rows[0]!.heads.map((_, i) => i).filter((i) => rows.some((r) => !lone(r) && r.cells[i]));
  if (keep.length === 0) return rows.flatMap(only);
  const heads = keep.map((i) => rows[0]!.heads[i]!);
  const widths = keep.map((i, k) => Math.max(heads[k]!.length, ...rows.map((r) => (lone(r) ? 0 : cell(r, i).length))));
  const gap = "  ";
  if (widths.reduce((a, b) => a + b, 0) + gap.length * (widths.length - 1) <= cols) {
    const line = (cells: string[]) => cells.map((c, k) => c.padEnd(widths[k]!)).join(gap).trimEnd();
    return [bold(line(heads)), ...rows.flatMap((r) => (lone(r) ? only(r) : [line(keep.map((i) => cell(r, i)))]))];
  }
  const width = Math.max(...heads.map((h) => h.length));
  // A cell wraps under itself, clear of the heads.
  const hang = " ".repeat(width + gap.length);
  return rows.flatMap((r, n) => [
    ...(n > 0 ? [""] : []),
    ...(lone(r)
      ? only(r)
      : keep.flatMap((i, k) =>
          lines(cell(r, i), Math.max(cols - hang.length, 20)).map((l, j) => (j === 0 ? `${bold(heads[k]!.padEnd(width))}${gap}${l}` : hang + l)),
        )),
  ]);
}

/** Where `text` breaks to fit `cols`: at the last space that fits, or mid-word when none does. */
function wrap(text: string, cols: number): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(text.length, at + cols);
    if (end < text.length) {
      const space = text.lastIndexOf(" ", end);
      if (space > at) end = space;
    }
    out.push([at, end]);
    at = end;
    while (text[at] === " ") at++;
  }
  return out;
}

/** Rows as tab-separated lines under their heads; a row of one cell is that cell alone. Tabs and newlines in a cell become spaces. */
export function tsvRows(rows: Row[]): string[] {
  const line = (cells: string[]) => cells.map((c) => c.replace(/[\t\n]/g, " ")).join("\t");
  return [line(rows[0]!.heads), ...rows.map((r) => (lone(r) ? line([r.cells.find(Boolean)!]) : line(r.cells)))];
}

/** A value goes before the link on its line; a passage or table goes under it. */
function printHit(kind: Kind | undefined, hit: { pdf: string; page: number; section: string; p: number }, answer: Answer | undefined, note = "", tsv = false) {
  const conf = answer ? `(p=${answer.p.toFixed(2)}${note})` : "";
  const long = kind === "passage" || kind === "table";
  if (!answer) console.log(hitLine(hit));
  else if (long && answer.passage) {
    const tty = process.stdout.isTTY;
    // Piped as TSV, stdout is the table alone, ready for a spreadsheet or cut.
    if (tsv && !tty) {
      console.error(`${conf}  ${hitLine(hit)}`);
      console.log(renderPassage(answer.passage, process.stdout.columns, false, true));
    } else console.log(`${conf}  ${hitLine(hit)}${tty ? "\n" : ""}\n${renderPassage(answer.passage, process.stdout.columns, tty, tsv)}`);
  } else if (long) console.log(`${conf}  ${hitLine(hit)}\n${answer.text.replace(/^/gm, "  ")}`);
  else console.log(`${answer.text}  ${conf}  ${hitLine(hit)}`);
}

/** Unless --no-highlight, each hit with passage lines or marks moved to a highlighted copy of its PDF, one copy per file marking every hit's. */
export async function highlightAll(hits: Hit[], o: ReadOpts): Promise<Hit[]> {
  const copies = new Set<string>();
  const out: Hit[] = [];
  for (const hit of hits) {
    const lines = hit.answer?.passage?.flatMap((p) => p.lines) ?? hit.answer?.marks ?? [];
    if (!o.highlight || lines.length === 0) {
      out.push(hit);
      continue;
    }
    const copy = await highlighted(hit.pdf, lines, !copies.has(hit.pdf));
    copies.add(hit.pdf);
    out.push({ ...hit, pdf: copy });
  }
  return out;
}

/** A hit as --json prints it: `view` is the copy with the answer highlighted, or `pdf` itself when there is none. */
export type JsonHit = {
  pdf: string;
  view: string;
  page: number;
  section: string;
  /** How sure the gate was that the page answers; the answer's own p is in `answer`. */
  found: number;
  answer?: { text: string; p: number; pages?: number[]; passage?: Omit<Para, "lines">[] };
};

/**
 * What --json prints on stdout: the hits that answered, or under "below" the
 * best one read, which did not reach the answer floor; "unanswered" has none
 * and says why in `message`. A table across the shelf fills `table` instead.
 */
export type JsonReport = {
  kind?: Kind;
  status: "answered" | "below" | "unanswered";
  hits: JsonHit[];
  message?: string;
  table?: { rows: string[]; columns: string[]; cells: { text: string; kind: Kind; why?: string; hit?: JsonHit }[][] };
  spent: Spent;
};

export const jsonHit = (hit: Hit, view = hit.pdf): JsonHit => ({
  pdf: hit.pdf,
  view,
  page: hit.page,
  section: hit.section,
  found: hit.p,
  answer: hit.answer && {
    text: hit.answer.text,
    p: hit.answer.p,
    pages: hit.answer.pages,
    // The boxes went into the highlight; the reader wants the text and its weights.
    passage: hit.answer.passage?.map(({ lines, ...p }) => p),
  },
});

/** Prints the outcome the way every tool does and exits: 0 on a hit, 1 otherwise. */
export async function report(
  tool: string,
  r: Outcome,
  o: ReadOpts,
  ui: Ui,
  since: Snapshot,
  ctx: { files?: number; nothing: string },
): Promise<never> {
  ui.clear();
  const walked = ctx.files === undefined ? "" : `, ${ctx.files} files opened, ${r.tried.length} windows read`;
  const json = (status: JsonReport["status"], hits: JsonHit[], message?: string) => {
    if (o.json) console.log(JSON.stringify({ kind: o.kind, status, hits, message, spent: spentSince(since) } satisfies JsonReport));
  };
  const fail: (message: string) => never = (message) => {
    ui.log(`total ${split(since)}${walked}`);
    console.error(`${tool}: ${message}`);
    json("unanswered", [], message);
    process.exit(1);
  };

  if (r.hit) {
    ui.log(`total ${split(since)}${walked}`);
    const hits = await highlightAll(r.hits, o);
    if (o.json) json("answered", hits.map((h, i) => jsonHit(r.hits[i]!, h.pdf)));
    else for (const hit of hits) printHit(o.kind, hit, hit.answer, "", o.tsv);
    if (o.open) await openAt(pageUrl(hits[0]!.pdf, hits[0]!.page));
    process.exit(0);
  }

  // Nothing cleared the floor, so report the best of what was read and say so.
  if (r.rejected.length > 0) {
    const { hit, answer } = r.rejected.reduce((a, b) => (b.answer.p > a.answer.p ? b : a));
    ui.log(`total ${split(since)}${walked}`);
    const message = `no answer reached p=${o.answerFloor} in ${r.rejected.length} windows; best follows`;
    console.error(`${tool}: ${message}`);
    if (o.json) json("below", [jsonHit({ ...hit, answer })], message);
    else printHit(o.kind, hit, answer, `, below ${o.answerFloor}`, o.tsv);
    process.exit(1);
  }

  if (r.tried.length === 0) fail(ctx.nothing);
  const across = ctx.files === undefined ? "" : ` across ${ctx.files} files`;
  // Dropped windows did pass the gate, so "no window reached the threshold"
  // would be false; say what actually happened.
  if (r.dropped.length > 0) {
    const where = r.dropped.map(({ hit }) => `${hit.section} p.${hit.page}`).join(", ");
    fail(`${r.dropped.length} windows${across} held the pages but did not state the answer in ${split(since)}: ${where}`);
  }
  const best = r.tried.reduce((a, b) => (b.p > a.p ? b : a));
  fail(
    `none of ${r.tried.length} windows${across} reached p=${o.threshold} in ${split(since)}; ` +
      `best was ${best.p.toFixed(2)} at ${best.name} p.${best.page}`,
  );
}
