#!/usr/bin/env bun
import { DEFAULT_MODEL, makeClient, rankTitles, snapshot, split, timed } from "./shared";
import { link, makeUi, openAt, pageUrl, searchPdf, type Candidate, type Hit, type Tried, type Verify } from "./pdf";
import { answerFrom, answerFromOutline, classify, type Kind } from "./answer";

type Opts = {
  question: string;
  threshold: number;
  fileFloor: number;
  titleFloor: number;
  maxFiles: number;
  max: number;
  chars: number;
  batch: number;
  model: string;
  quiet: boolean;
  open: boolean;
  countMax: number;
  answerFloor: number;
  noToc: boolean;
  maxAnswers: number;
  kind?: Kind;
};

function usage(code: number): never {
  (code === 0 ? console.log : console.error)(`jevfind — find the page that answers a question, across many PDFs

  find . -name '*.pdf' | jevfind "How does character creation work?"

Ranks the paths by filename, then walks them best-first: each PDF's outline is
ranked by section title, and sections are read until one answers the question.

  -t, --threshold P    yes-probability needed to stop, 0-1 (default 0.7)
      --file-floor F   skip files scoring below F on filename, 0-3 (default 1.5)
      --title-floor F  skip sections scoring below F on title, 0-3 (default 1.0)
      --max-files N    open at most N files (default 5)
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
      --kind K         force count, truth or passage instead of asking jev

Reads paths on stdin. Only PDFs with an outline are searched; anything else is
logged and skipped. Needs $OPENROUTER_API_KEY, mutool and pdftotext.`);
  process.exit(code);
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = {
    question: "",
    threshold: 0.7,
    fileFloor: 1.5,
    titleFloor: 1.0,
    maxFiles: 5,
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
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i] ?? "";
    if (a === "-t" || a === "--threshold") o.threshold = Number(next());
    else if (a === "--file-floor") o.fileFloor = Number(next());
    else if (a === "--title-floor") o.titleFloor = Number(next());
    else if (a === "--max-files") o.maxFiles = Number(next());
    else if (a === "--max") o.max = Number(next());
    else if (a === "--chars") o.chars = Number(next());
    else if (a === "--batch") o.batch = Number(next());
    else if (a === "--model") o.model = next();
    else if (a === "-q" || a === "--quiet") o.quiet = true;
    else if (a === "--open") o.open = true;
    else if (a === "--count-max") o.countMax = Number(next());
    else if (a === "--answer-floor") o.answerFloor = Number(next());
    else if (a === "--no-toc") o.noToc = true;
    else if (a === "--max-answers") o.maxAnswers = Number(next());
    else if (a === "--kind") o.kind = next() as Kind;
    else if (a === "-h" || a === "--help") usage(0);
    else rest.push(a);
  }
  o.question = rest.join(" ").trim();
  if (!o.question) usage(1);
  return o;
}

const startSnap = snapshot();
const opts = parseArgs(Bun.argv.slice(2));

const paths = (await timed("wait", () => Bun.stdin.text()))
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

if (paths.length === 0) {
  console.error("jevfind: no paths on stdin");
  process.exit(2);
}

const client = await makeClient(opts.model);
const ui = makeUi(opts.quiet);

const kind = opts.kind ?? (await classify(client, opts.question));
ui.log(`question looks like a ${kind} question`);

const rankSnap = snapshot();
const all = await rankTitles(client, opts.question, paths, opts.batch, "file named");
const ranked = all.filter((r) => r.score >= opts.fileFloor).slice(0, opts.maxFiles);
ui.log(
  `ranked ${all.length} paths in ${split(rankSnap)}, ` +
    `${ranked.length} above file floor ${opts.fileFloor}` +
    (all.length > ranked.length ? ` (${all.length - ranked.length} skipped)` : ""),
);

// Only count and truth questions have an answer to be confident about; a
// passage question is satisfied by the window itself.
const fromOutline = opts.noToc
  ? undefined
  : (paths: string[]) => answerFromOutline(client, kind, opts.question, paths, opts.answerFloor);

const verify: Verify | undefined =
  kind === "passage"
    ? undefined
    : async (section, _page, text) => {
        const a = (await answerFrom(client, kind, opts.question, section, text, opts.countMax))!;
        return { ...a, ok: a.p >= opts.answerFloor };
      };

let hit: Hit | undefined;
const tried: Tried[] = [];
const rejected: Candidate[] = [];
let opened = 0;

for (const r of ranked) {
  const fileSnap = snapshot();
  ui.log(`${r.score.toFixed(2)}  ${r.name}`);
  if (!r.name.toLowerCase().endsWith(".pdf")) {
    ui.log(`  --  not a PDF, skipped`);
    continue;
  }
  if (!(await Bun.file(r.name).exists())) {
    ui.log(`  --  no such file, skipped`);
    continue;
  }
  opened++;
  const res = await searchPdf(client, r.name, { ...opts, verify, fromOutline, maxAnswers: opts.maxAnswers - rejected.length }, ui, "  ");
  tried.push(...res.tried);
  rejected.push(...res.rejected);
  ui.log(`  file ${split(fileSnap)}  ${res.tried.length} windows read`);
  if (res.hit) {
    hit = res.hit;
    break;
  }
  if (rejected.length >= opts.maxAnswers) break;
}

ui.clear();
if (hit) {
  ui.log(`total ${split(startSnap)}, ${opened} files opened, ${tried.length} windows read`);
  const prefix = hit.answer ? `${hit.answer.text}  (p=${hit.answer.p.toFixed(2)})  ` : "";
  console.log(`${prefix}${link(hit.pdf, hit.page)}  ${hit.section}  (found p=${hit.p.toFixed(2)})`);
  if (opts.open) await openAt(pageUrl(hit.pdf, hit.page));
  process.exit(0);
}

// Nothing cleared the floor, so report the best of what was read and say so.
if (rejected.length > 0) {
  const { hit: h, answer } = rejected.reduce((a, b) => (b.answer.p > a.answer.p ? b : a));
  ui.log(`total ${split(startSnap)}, ${opened} files opened, ${tried.length} windows read`);
  console.error(`jevfind: no answer reached p=${opts.answerFloor} in ${rejected.length} windows; best follows`);
  console.log(
    `${answer.text}  (p=${answer.p.toFixed(2)}, below ${opts.answerFloor})  ` +
      `${link(h.pdf, h.page)}  ${h.section}  (found p=${h.p.toFixed(2)})`,
  );
  process.exit(1);
}

if (tried.length === 0) {
  console.error(
    `jevfind: nothing searchable above the floors in ${split(startSnap)}; ` +
      `${ranked.length} paths passed the filename floor, ${opened} were readable PDFs`,
  );
  process.exit(1);
}
const best = tried.reduce((a, b) => (b.p > a.p ? b : a));
console.error(
  `jevfind: none of ${tried.length} windows across ${opened} files reached p=${opts.threshold} ` +
    `in ${split(startSnap)}; best was ${best.p.toFixed(2)} at ${best.name} p.${best.page}`,
);
process.exit(1);
