#!/usr/bin/env bun
import { DEFAULT_MODEL, makeClient, rankTitles, snapshot, split, timed } from "./shared";
import { link, makeUi, openAt, pageUrl, searchPdf, type Hit, type Tried } from "./pdf";

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

const rankSnap = snapshot();
const all = await rankTitles(client, opts.question, paths, opts.batch, "file named");
const ranked = all.filter((r) => r.score >= opts.fileFloor).slice(0, opts.maxFiles);
ui.log(
  `ranked ${all.length} paths in ${split(rankSnap)}, ` +
    `${ranked.length} above file floor ${opts.fileFloor}` +
    (all.length > ranked.length ? ` (${all.length - ranked.length} skipped)` : ""),
);

let hit: Hit | undefined;
const tried: Tried[] = [];
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
  const res = await searchPdf(client, r.name, opts, ui, "  ");
  tried.push(...res.tried);
  ui.log(`  file ${split(fileSnap)}  ${res.tried.length} windows read`);
  if (res.hit) {
    hit = res.hit;
    break;
  }
}

ui.clear();
if (hit) {
  ui.log(`total ${split(startSnap)}, ${opened} files opened, ${tried.length} windows read`);
  console.log(`${link(hit.pdf, hit.page)}  ${hit.section}  (p=${hit.p.toFixed(2)})`);
  if (opts.open) await openAt(pageUrl(hit.pdf, hit.page));
  process.exit(0);
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
