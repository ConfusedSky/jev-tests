#!/usr/bin/env bun
import { DEFAULT_MODEL, makeClient, snapshot, split } from "./shared";
import { link, makeUi, openAt, pageUrl, searchPdf } from "./pdf";
import { answerFrom, classify, type Kind } from "./answer";

type Opts = {
  pdf: string;
  question: string;
  threshold: number;
  titleFloor: number;
  max: number;
  chars: number;
  batch: number;
  model: string;
  quiet: boolean;
  open: boolean;
  countMax: number;
  kind?: Kind;
};

function usage(code: number): never {
  (code === 0 ? console.log : console.error)(`jevsec — find the section of a PDF that answers a question

  jevsec book.pdf "How does character creation work?"

Ranks outline sections by title, then reads them in that order and stops at
the first section whose text actually answers the question.

  -t, --threshold P    yes-probability needed to stop, 0-1 (default 0.7)
      --title-floor F  skip sections scoring below F on title, 0-3 (default 1.0)
      --max N          read at most N sections (default 12)
      --chars N        characters of text per call (default 48000)
      --batch N        titles per ranking call (default 40)
      --model SLUG     default ~typesafe/jev-latest, or $JEVGREP_MODEL
  -q, --quiet          only print the hit
      --open           open the hit in your PDF viewer, at the page
      --count-max N    largest exact count jev may answer with (default 50)
      --kind K         force count, truth or passage instead of asking jev

Needs $OPENROUTER_API_KEY, mutool and pdftotext.`);
  process.exit(code);
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = {
    pdf: "",
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
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i] ?? "";
    if (a === "-t" || a === "--threshold") o.threshold = Number(next());
    else if (a === "--title-floor") o.titleFloor = Number(next());
    else if (a === "--max") o.max = Number(next());
    else if (a === "--chars") o.chars = Number(next());
    else if (a === "--batch") o.batch = Number(next());
    else if (a === "--model") o.model = next();
    else if (a === "-q" || a === "--quiet") o.quiet = true;
    else if (a === "--open") o.open = true;
    else if (a === "--count-max") o.countMax = Number(next());
    else if (a === "--kind") o.kind = next() as Kind;
    else if (a === "-h" || a === "--help") usage(0);
    else rest.push(a);
  }
  o.pdf = rest.shift() ?? "";
  o.question = rest.join(" ").trim();
  if (!o.pdf || !o.question) usage(1);
  return o;
}

const startSnap = snapshot();
const opts = parseArgs(Bun.argv.slice(2));
if (!(await Bun.file(opts.pdf).exists())) {
  console.error(`jevsec: no such file: ${opts.pdf}`);
  process.exit(2);
}

const client = await makeClient(opts.model);
const ui = makeUi(opts.quiet);

const kind = opts.kind ?? (await classify(client, opts.question));
ui.log(`question looks like a ${kind} question`);

const { hit, tried } = await searchPdf(client, opts.pdf, opts, ui);

ui.clear();
if (hit) {
  const answer = await answerFrom(client, kind, opts.question, hit.section, hit.text, opts.countMax);
  ui.log(`total ${split(startSnap)}`);
  const prefix = answer ? `${answer.text}  (p=${answer.p.toFixed(2)})  ` : "";
  console.log(`${prefix}${link(hit.pdf, hit.page)}  ${hit.section}  (found p=${hit.p.toFixed(2)})`);
  if (opts.open) await openAt(pageUrl(hit.pdf, hit.page));
  process.exit(0);
}

if (tried.length === 0) {
  console.error(`jevsec: nothing readable scored above the title floor ${opts.titleFloor}`);
  process.exit(1);
}
const best = tried.reduce((a, b) => (b.p > a.p ? b : a));
console.error(
  `jevsec: none of ${tried.length} windows reached p=${opts.threshold} in ${split(startSnap)}; ` +
    `best was ${best.p.toFixed(2)} at ${best.name} p.${best.page}`,
);
process.exit(1);
