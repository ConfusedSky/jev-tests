#!/usr/bin/env bun
import { answerLayer, checkCache, num, parseFlags, READ_USAGE, readFlags, report } from "./cli";
import { makeUi } from "./pdf";
import { acrossTable, ACROSS, findDefaults, findIn, readAcross, reportAcross, type FindOpts } from "./shelf";
import { makeClient, snapshot, split, timed } from "./shared";

type Opts = FindOpts & { across?: boolean };

function usage(code: number): never {
  (code === 0 ? console.log : console.error)(`jevfind — find the page that answers a question, across many PDFs

  find . -name '*.pdf' | jevfind "How does character creation work?"
  ls *.pdf | jevfind "Give me a table with Heart and Fallout as rows and ask how many skills are there"

Ranks the paths by filename and by the pages that mention the question's
subject, then walks them best-first: each PDF's outline is ranked by section
title beside those pages, and they are read until one answers the question.

A table whose rows are documents the question names asks each column's
question of each row, walking only files whose names clear the file floor.

      --file-floor F   open files scoring below F on filename only while nothing has
                       answered, 0-3 (default 1.5)
      --max-files N    open at most N files (default 5)
      --across         build a table whose rows are the documents the question names
      --no-across      build any table from one document's pages, without asking
${READ_USAGE}

Reads paths on stdin. A PDF without an outline is read window by window in
page order; anything that is not a PDF is logged and skipped.
Needs $OPENROUTER_API_KEY, mutool and pdftotext.`);
  process.exit(code);
}

const startSnap = snapshot();
const opts: Opts = findDefaults();
const words = parseFlags(
  Bun.argv.slice(2),
  opts,
  {
    ...readFlags(),
    "--file-floor": num("fileFloor"),
    "--max-files": num("maxFiles"),
    "--across": (o, _next, fail) => (o.across === false ? fail("cannot go with --no-across") : (o.across = true)),
    "--no-across": (o, _next, fail) => (o.across === true ? fail("cannot go with --across") : (o.across = false)),
  },
  usage,
);
opts.question = words.join(" ").trim();
if (!opts.question) usage(1);
// A table across the shelf has one row per document and one answer per cell.
if (opts.across && opts.kind !== undefined && opts.kind !== "table") {
  console.error(`--across builds a table; it cannot go with --kind ${opts.kind}`);
  usage(1);
}
if (opts.across && opts.hits > 1) {
  console.error(`--hits only applies to a passage question; --across builds a table`);
  usage(1);
}

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

/** Builds the table across the shelf when the rows name documents, or when told to; returns when it does not. */
async function across(forced: boolean) {
  const readSnap = snapshot();
  const read = await readAcross(client, opts.question);
  const named = read.rows.length > 0 && read.columns.length > 0;
  const p = `(p=${read.p.toFixed(2)})`;
  if (!forced && read.p < ACROSS) return ui.log(`rows are things in one document ${p}  in ${split(readSnap)}`);
  if (!named) {
    ui.log(`rows name documents ${p}, but no ${read.rows.length ? "question" : "row"} was read  in ${split(readSnap)}`);
    if (!forced) return;
    console.error(`jevfind: found no ${read.rows.length ? "question to ask of each row" : "document named as a row"} in the question`);
    process.exit(1);
  }
  ui.log(`rows name documents ${p}: ${read.rows.join(", ")}; asks ${read.columns.join("; ")}  in ${split(readSnap)}`);
  await reportAcross("jevfind", await acrossTable(client, paths, opts, read.rows, read.columns, ui), opts, ui, startSnap);
}

// Told to go across, the question's own reading would go unused.
if (opts.across) {
  await checkCache(opts.cache);
  await across(true);
}
const search = await answerLayer(client, opts, ui);
if (search.kind === "table" && opts.across === undefined) await across(false);

const r = await findIn(client, paths, search, ui);
await report("jevfind", r, search, ui, startSnap, {
  files: r.opened,
  nothing:
    `nothing searchable in ${split(startSnap)}; ` +
    `${r.above} paths passed the filename floor, ${r.opened} of the first ${r.considered} were readable PDFs`,
});
