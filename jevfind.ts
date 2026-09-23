#!/usr/bin/env bun
import { answerLayer, num, parseFlags, READ_USAGE, readDefaults, readFlags, report, type ReadOpts } from "./cli";
import { bookText, makeUi, searchPdf, type Candidate, type Hit, type Tried } from "./pdf";
import { excerpts, weighted, type Excerpt } from "./search";
import { makeClient, rank, snapshot, split, timed } from "./shared";

type Opts = ReadOpts & { fileFloor: number; maxFiles: number };

function usage(code: number): never {
  (code === 0 ? console.log : console.error)(`jevfind — find the page that answers a question, across many PDFs

  find . -name '*.pdf' | jevfind "How does character creation work?"

Ranks the paths by filename and by the pages that mention the question's
subject, then walks them best-first: each PDF's outline is ranked by section
title beside those pages, and they are read until one answers the question.

      --file-floor F   open files scoring below F on filename only while nothing has
                       answered, 0-3 (default 1.5)
      --max-files N    open at most N files (default 5)
${READ_USAGE}

Reads paths on stdin. A PDF without an outline is read window by window in
page order; anything that is not a PDF is logged and skipped.
Needs $OPENROUTER_API_KEY, mutool and pdftotext.`);
  process.exit(code);
}

const startSnap = snapshot();
const opts: Opts = { ...readDefaults(), fileFloor: 1.5, maxFiles: 5 };
const words = parseFlags(
  Bun.argv.slice(2),
  opts,
  { ...readFlags(), "--file-floor": num("fileFloor"), "--max-files": num("maxFiles") },
  usage,
);
opts.question = words.join(" ").trim();
if (!opts.question) usage(1);

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
const search = await answerLayer(client, opts, ui);

const rankSnap = snapshot();
// A file's name may say nothing of what it holds, so the pages of every
// readable PDF that mention the subject are ranked beside the names, and a
// file opens on the better of the two. Each book is extracted once and cached.
const found: { file: string; excerpt: Excerpt }[] = [];
if (search.terms) {
  const pdfs = (await Promise.all(paths.map(async (p) => (p.toLowerCase().endsWith(".pdf") && (await Bun.file(p).exists()) ? p : undefined)))).filter((p) => p !== undefined);
  for (let i = 0; i < pdfs.length; i += 4) {
    await Promise.all(
      pdfs.slice(i, i + 4).map(async (file) => {
        const pages = await bookText(file);
        for (const excerpt of excerpts(pages, weighted(search.terms!, pages), { limit: 3 })) found.push({ file, excerpt });
      }),
    );
  }
}
const scored = await rank(
  client,
  opts.question,
  [
    { key: "candidates", noun: "file named", items: paths.map((p) => ({ label: p, value: p })) },
    {
      key: "excerpts",
      noun: "page excerpt",
      items: found.map(({ file, excerpt: e }) => ({ label: `${file.split("/").pop()} p.${e.page} ${e.content}`, value: { file, page: e.page, content: e.content } })),
    },
  ],
  opts.batch,
);
const all = paths
  .map((name) => {
    const own = scored.find((r) => r.list === "candidates" && r.name === name)!;
    const pages = scored.filter((r) => r.list === "excerpts" && found[r.index]!.file === name);
    const best = pages.find((r) => r.score > own.score);
    return { name, score: best?.score ?? own.score, by: best ? `p.${found[best.index]!.excerpt.page}` : "name" };
  })
  .sort((a, b) => b.score - a.score);
const ranked = all.slice(0, opts.maxFiles);
const above = all.filter((r) => r.score >= opts.fileFloor).length;
ui.log(
  `ranked ${paths.length} paths and ${found.length} excerpts in ${split(rankSnap)}, ` +
    `${above} above file floor ${opts.fileFloor}` +
    (all.length > above ? ` (${all.length - above} below)` : ""),
);

const hits: Hit[] = [];
const tried: Tried[] = [];
const rejected: Candidate[] = [];
const dropped: Candidate[] = [];
let opened = 0;
let below = false;

for (const r of ranked) {
  // The floor is soft: a file that scored under it is opened only while
  // nothing has answered. "Which items cost more than 900 caps" says nothing a
  // filename can match, and the rulebook holding the answer scored 1.48.
  // Above the floor -n windows are collected; below it one is enough.
  if (r.score < opts.fileFloor) {
    if (hits.length > 0) break;
    if (!below) ui.log(`nothing above the file floor answered; opening files below it`);
    below = true;
  }
  const fileSnap = snapshot();
  ui.log(`${r.score.toFixed(2)}  ${r.name}${r.by === "name" ? "" : `  (by ${r.by})`}`);
  if (!r.name.toLowerCase().endsWith(".pdf")) {
    ui.log(`  --  not a PDF, skipped`);
    continue;
  }
  if (!(await Bun.file(r.name).exists())) {
    ui.log(`  --  no such file, skipped`);
    continue;
  }
  opened++;
  // The answer budget spans files, so each file gets what the last one left.
  const res = await searchPdf(
    client,
    r.name,
    { ...search, maxAnswers: opts.maxAnswers - rejected.length, hits: opts.hits - hits.length },
    ui,
    "  ",
  );
  tried.push(...res.tried);
  rejected.push(...res.rejected);
  dropped.push(...res.dropped);
  ui.log(`  file ${split(fileSnap)}  ${res.tried.length} windows read`);
  hits.push(...res.hits);
  if (hits.length >= opts.hits || rejected.length >= opts.maxAnswers) break;
}

await report("jevfind", { hit: hits[0], hits, tried, rejected, dropped }, search, ui, startSnap, {
  files: opened,
  nothing:
    `nothing searchable in ${split(startSnap)}; ` +
    `${above} paths passed the filename floor, ${opened} of the first ${ranked.length} were readable PDFs`,
});
