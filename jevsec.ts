#!/usr/bin/env bun
import { answerLayer, parseFlags, READ_USAGE, readDefaults, readFlags, report } from "./cli";
import { makeUi, searchPdf, unopenable } from "./pdf";
import { composeTable } from "./compose";
import { makeClient, snapshot } from "./shared";

function usage(code: number): never {
  (code === 0 ? console.log : console.error)(`jevsec — find the section of a PDF that answers a question

  jevsec book.pdf "How does character creation work?"

Ranks outline sections by title, then reads them in that order and stops at
the first section whose text actually answers the question.

${READ_USAGE}

Needs $OPENROUTER_API_KEY, mutool and pdftotext.`);
  process.exit(code);
}

const startSnap = snapshot();
const opts = readDefaults();
const [pdf = "", ...words] = parseFlags(Bun.argv.slice(2), opts, readFlags(), usage);
opts.question = words.join(" ").trim();
if (!pdf || !opts.question) usage(1);
if (!(await Bun.file(pdf).exists())) {
  console.error(`jevsec: no such file: ${pdf}`);
  process.exit(2);
}
if (Bun.file(pdf).size === 0) {
  console.error(`jevsec: empty file, nothing to read: ${pdf}`);
  process.exit(2);
}
const broken = await unopenable(pdf);
if (broken) {
  console.error(`jevsec: not a PDF mutool can open (${broken}): ${pdf}`);
  process.exit(2);
}

const client = await makeClient(opts.model);
const ui = makeUi(opts.quiet);
const search = await answerLayer(client, opts, ui);
const outcome = search.kind === "table" ? await composeTable(client, pdf, search, ui) : await searchPdf(client, pdf, search, ui);
await report("jevsec", outcome, search, ui, startSnap, {
  nothing: `nothing readable scored above the title floor ${opts.titleFloor}`,
});
