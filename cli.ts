import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { answerFrom, answerFromOutline, classify, KINDS, type Kind } from "./answer";
import { link, openAt, pageUrl, type Outcome, type SearchOpts, type Ui } from "./pdf";
import { DEFAULT_MODEL, split, type Snapshot } from "./shared";

/** A flag's handler; `next` consumes the following argument. */
export type Flags<O> = Record<string, (o: O, next: () => string) => void>;

/** Applies `flags` (keyed "-x|--long") to `o`; returns the positionals. `-h` calls `usage(0)`. */
export function parseFlags<O>(argv: string[], o: O, flags: Flags<O>, usage: (code: number) => never): string[] {
  const byName = new Map(Object.entries(flags).flatMap(([names, set]) => names.split("|").map((n) => [n, set])));
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const set = byName.get(a);
    if (set) set(o, () => argv[++i] ?? "");
    else if (a === "-h" || a === "--help") usage(0);
    else rest.push(a);
  }
  return rest;
}

type NumKeys<O> = { [K in keyof O]: O[K] extends number ? K : never }[keyof O];
export const num = <O extends object>(key: NumKeys<O>) => (o: O, next: () => string) => {
  Object.assign(o, { [key]: Number(next()) });
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
});

export const readFlags = (usage: (code: number) => never): Flags<ReadOpts> => ({
  "-t|--threshold": num("threshold"),
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
  "--no-toc": (o) => (o.noToc = true),
  "--kind": (o, next) => {
    const k = next();
    if (!KINDS.some((x) => x === k)) usage(1);
    o.kind = k as Kind;
  },
});

export const READ_USAGE = `  -t, --threshold P    yes-probability needed to stop, 0-1 (default 0.7)
      --title-floor F  skip sections scoring below F on title, 0-3 (default 1.0)
      --max N          read at most N sections per file (default 12)
      --chars N        characters of text per call (default 48000)
      --batch N        names per ranking call (default 40)
      --model SLUG     default ~typesafe/jev-latest, or $JEVGREP_MODEL
  -q, --quiet          only print the hit
      --open           open the hit in your PDF viewer, at the page
      --count-max N    largest exact count jev may answer with (default 50)
      --answer-floor P confidence a count or true/false must reach, 0-1 (default 0.7)
      --max-answers N  windows to read out before settling for the best (default 5)
      --no-toc         never answer from the table of contents alone
      --kind K         force count, truth or passage instead of asking jev`;

/**
 * Wires the answer layer into a search: only count and truth questions have a
 * value to be confident about, so a passage question gets no verifier.
 */
export async function answerLayer(client: TypeSafeClient, o: ReadOpts, ui: Ui): Promise<ReadOpts> {
  const kind = o.kind ?? (await classify(client, o.question));
  ui.log(`question looks like a ${kind} question`);
  const fromOutline = o.noToc
    ? undefined
    : (paths: string[]) => answerFromOutline(client, kind, o.question, paths, o.answerFloor);
  const verify: SearchOpts["verify"] =
    kind === "passage"
      ? undefined
      : async (section, _page, text) => {
          const a = await answerFrom(client, kind, o.question, section, text, o.countMax);
          return { ...a, ok: a.p >= o.answerFloor };
        };
  return { ...o, kind, verify, fromOutline };
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
    const prefix = r.hit.answer ? `${r.hit.answer.text}  (p=${r.hit.answer.p.toFixed(2)})  ` : "";
    console.log(`${prefix}${hitLine(r.hit)}`);
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
  const best = r.tried.reduce((a, b) => (b.p > a.p ? b : a));
  const across = ctx.files === undefined ? "" : ` across ${ctx.files} files`;
  console.error(
    `${tool}: none of ${r.tried.length} windows${across} reached p=${o.threshold} in ${split(since)}; ` +
      `best was ${best.p.toFixed(2)} at ${best.name} p.${best.page}`,
  );
  process.exit(1);
}
