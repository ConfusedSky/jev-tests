import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { answerFrom, answerFromOutline, classify, countAcross, KINDS, quantitiesOf, type Answer, type Judged, type Kind } from "./answer";
import { GATE, link, openAt, pageUrl, type Outcome, type SearchOpts, type Ui } from "./pdf";
import { DEFAULT_MODEL, split, type Snapshot } from "./shared";

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

/** Options every PDF-reading tool shares; jevfind adds its file-level floors on top. */
export type ReadOpts = SearchOpts & {
  model: string;
  quiet: boolean;
  open: boolean;
  countMax: number;
  answerFloor: number;
  noToc: boolean;
  maxAnswers: number;
  perPage: boolean;
  hits: number;
  kind?: Kind;
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
  countMax: 50,
  answerFloor: 0.7,
  noToc: false,
  maxAnswers: 5,
  perPage: true,
  hits: 1,
});

export const readFlags = (): Flags<ReadOpts> => ({
  "-t|--threshold": num("threshold"),
  "-n|--hits": num("hits"),
  "--title-floor": num("titleFloor"),
  "--max": num("max"),
  "--chars": num("chars"),
  "--batch": num("batch"),
  "--count-max": num("countMax"),
  "--answer-floor": num("answerFloor"),
  "--max-answers": num("maxAnswers"),
  "--model": (o, next) => (o.model = next()),
  "-q|--quiet": (o) => (o.quiet = true),
  "--open": (o) => (o.open = true),
  "--whole-windows": (o) => (o.perPage = false),
  "--no-toc": (o) => (o.noToc = true),
  "--kind": (o, next, fail) => {
    const k = next();
    if (!KINDS.some((x) => x === k)) fail(`must be one of ${KINDS.join(", ")}`);
    o.kind = k as Kind;
  },
});

export const READ_USAGE = `  -t, --threshold P    yes-probability needed to stop, 0-1 (default 0.7)
  -n, --hits N         keep walking until N passages have passed (passage questions only)
      --title-floor F  read sections scoring below F on title only while fewer than
                       -n windows have answered, 0-3 (default 1.0)
      --max N          read at most N sections per file (default 12)
      --chars N        characters of text per call (default 48000)
      --whole-windows  gate a window of text at a time instead of every page
      --batch N        names per ranking call (default 40)
      --model SLUG     default ~typesafe/jev-latest, or $JEVGREP_MODEL
  -q, --quiet          only print the hit
      --open           open the hit in your PDF viewer, at the page
      --count-max N    largest exact count jev may answer with (default 50)
      --answer-floor P confidence a count or true/false must reach, 0-1 (default 0.7)
      --max-answers N  windows to read out before settling for the best (default 5)
      --no-toc         never answer from the table of contents alone
      --kind K         force count, number, truth or passage instead of asking jev`;

/**
 * Wires the answer layer into a search: only count and truth questions have a
 * value to be confident about, so a passage question gets no verifier.
 */
export async function answerLayer(client: TypeSafeClient, o: ReadOpts, ui: Ui): Promise<ReadOpts> {
  const kind = o.kind ?? (await classify(client, o.question));
  ui.log(o.kind ? `question treated as a ${kind} question` : `question looks like a ${kind} question`);
  // A count, number or statement has one answer; only a passage question has
  // several places worth reading.
  if (o.hits > 1 && kind !== "passage") {
    console.error(`--hits ${o.hits} only applies to a passage question; this is a ${kind} question`);
    process.exit(2);
  }
  // "the cost, weight and damage rating of a combat rifle" is three figures off one page.
  const wanted = kind === "number" ? await quantitiesOf(client, o.question) : [];
  if (wanted.length > 1) ui.log(`asks for ${wanted.join(", ")}`);
  const fromOutline = o.noToc
    ? undefined
    : (sections: Parameters<NonNullable<SearchOpts["fromOutline"]>>[0]) =>
        answerFromOutline(client, kind, o.question, sections, o.answerFloor);
  // "not stated" is a refusal, not an answer, so it never settles a walk
  // however confident the model is that it cannot say. "over N" is an answer.
  const judge = (a: Answer): Judged => ({
    ...a,
    verdict: a.text === "not stated" ? "drop" : a.p >= o.answerFloor ? "take" : "keep",
  });
  const verify: SearchOpts["verify"] =
    kind === "passage"
      ? undefined
      : async (section, _page, text) =>
          judge(await answerFrom(client, kind, o.question, section, text, o.countMax, wanted));
  const across: SearchOpts["countAcross"] =
    kind !== "count"
      ? undefined
      : async (section, windows) =>
          judge(
            await countAcross(client, o.question, section, windows, o.countMax, o.answerFloor, (page, part, counted, running) =>
              ui.log(
                `    ${counted ? "+" : "?"}${part.text.padStart(3)} (p=${part.p.toFixed(2)})  p.${page}  ` +
                  (counted ? `running ${running}` : "unsure, left out"),
              ),
            ),
          );
  return { ...o, kind, verify, fromOutline, countAcross: across, gate: kind === "count" ? GATE.list : GATE.answer };
}

const hitLine = (h: { pdf: string; page: number; section: string; p: number }) =>
  `${link(h.pdf, h.page)}  ${h.section}  (found p=${h.p.toFixed(2)})`;

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

  if (r.hit) {
    ui.log(`total ${split(since)}${walked}`);
    for (const hit of r.hits) {
      const prefix = hit.answer ? `${hit.answer.text}  (p=${hit.answer.p.toFixed(2)})  ` : "";
      console.log(`${prefix}${hitLine(hit)}`);
    }
    if (o.open) await openAt(pageUrl(r.hit.pdf, r.hit.page));
    process.exit(0);
  }

  // Nothing cleared the floor, so report the best of what was read and say so.
  if (r.rejected.length > 0) {
    const { hit, answer } = r.rejected.reduce((a, b) => (b.answer.p > a.answer.p ? b : a));
    ui.log(`total ${split(since)}${walked}`);
    console.error(`${tool}: no answer reached p=${o.answerFloor} in ${r.rejected.length} windows; best follows`);
    console.log(`${answer.text}  (p=${answer.p.toFixed(2)}, below ${o.answerFloor})  ${hitLine(hit)}`);
    process.exit(1);
  }

  if (r.tried.length === 0) {
    console.error(`${tool}: ${ctx.nothing}`);
    process.exit(1);
  }
  const across = ctx.files === undefined ? "" : ` across ${ctx.files} files`;
  // Dropped windows did pass the gate, so "no window reached the threshold"
  // would be false; say what actually happened.
  if (r.dropped.length > 0) {
    const where = r.dropped.map(({ hit }) => `${hit.section} p.${hit.page}`).join(", ");
    console.error(
      `${tool}: ${r.dropped.length} windows${across} held the pages but stated no number in ${split(since)}: ${where}`,
    );
    process.exit(1);
  }
  const best = r.tried.reduce((a, b) => (b.p > a.p ? b : a));
  console.error(
    `${tool}: none of ${r.tried.length} windows${across} reached p=${o.threshold} in ${split(since)}; ` +
      `best was ${best.p.toFixed(2)} at ${best.name} p.${best.page}`,
  );
  process.exit(1);
}
