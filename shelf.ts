/**
 * Questions over many PDFs: the paths ranked and walked best-first until one
 * answers (jevfind), and tables whose rows are documents the question names
 * and whose columns are questions asked of each, every cell a walk of its own.
 */
import { noul, type TypeSafeClient } from "@typesafe-ai/sdk";
import { normalize, STOPWORDS, wordsOf, type Answer, type Kind, type Word } from "./answer";
import { answerLayer, highlightAll, hitLine, readDefaults, renderPassage, sizedHit, type JsonReport, type ReadOpts } from "./cli";
import { composeTable, NA, namesBy } from "./compose";
import { rowText, type Para, type Row } from "./layout";
import { openAt, pageUrl, searchPdf, textFile, type Candidate, type Hit, type Outcome, type Tried, type Ui } from "./pdf";
import { excerpts, type Excerpt } from "./search";
import { rank, snapshot, spentSince, split, timed, type Snapshot } from "./shared";

export type FindOpts = ReadOpts & { fileFloor: number; maxFiles: number };
export const findDefaults = (): FindOpts => ({ ...readDefaults(), fileFloor: 1.5, maxFiles: 5 });

/** A walk over the shelf, and what `report` says of it when nothing answered. */
export type Walked = Outcome & { opened: number; above: number; considered: number };

/** What findIn reads the files through; a test passes its own. */
export type FindIo = { searchPdf: typeof searchPdf; composeTable: typeof composeTable };
const FIND_IO: FindIo = { searchPdf, composeTable };

/**
 * Ranks `paths` by name and by the pages that mention the question's
 * subject, then walks them best-first until one answers. With `hard`, a file
 * whose name falls below the floor is never opened: a table's row names its
 * document, and another file's answer would stand in that row.
 */
export async function findIn(client: TypeSafeClient, paths: string[], search: FindOpts, ui: Ui, { hard = false } = {}, io: FindIo = FIND_IO): Promise<Walked> {
  const rankSnap = snapshot();
  // A file's name may say nothing of what it holds, so the pages of every
  // readable PDF that mention the subject are ranked beside the names, and a
  // file opens on the better of the two. Each book is extracted once and cached.
  const found: { file: string; excerpt: Excerpt }[] = [];
  // A count ranks titles alone inside a file, so its files rank by name alone
  // too; under a hard floor an excerpt could only reorder files never opened.
  if (search.terms && !search.countAcross && !hard) {
    const pdfs = (await Promise.all(paths.map(async (p) => (p.toLowerCase().endsWith(".pdf") && (await Bun.file(p).exists()) ? p : undefined)))).filter((p) => p !== undefined);
    // Extracted four at a time; one book pdftotext cannot read is skipped, not fatal.
    const texts = new Map<string, string>();
    for (let i = 0; i < pdfs.length; i += 4) {
      await Promise.all(
        pdfs.slice(i, i + 4).map(async (pdf) => {
          try {
            texts.set(pdf, await textFile(pdf));
          } catch (e) {
            ui.log(`  --  ${pdf}: ${e instanceof Error ? e.message.split("\n")[0] : e}; skipped`);
          }
        }),
      );
    }
    const byFile = await excerpts([...texts.values()], search.terms, { limit: 3 });
    for (const [pdf, file] of texts) for (const excerpt of byFile.get(file) ?? []) found.push({ file: pdf, excerpt });
  }
  const scored = await rank(
    client,
    search.question,
    [
      { key: "candidates", noun: "file named", items: paths.map((p) => ({ label: p, value: p })) },
      {
        key: "excerpts",
        noun: "page excerpt",
        items: found.map(({ file, excerpt: e }) => ({ label: `${file.split("/").pop()} p.${e.page} ${e.content}`, value: { file, page: e.page, content: e.content } })),
      },
    ],
    search.batch,
  );
  // A name that clears the floor is trusted over any page: a supplement's
  // page on perks outranked the core rulebook's name and answered from armor
  // mods. Below the floor the names say nothing, and a file's best page
  // orders it instead, still under the floor.
  const all = paths
    .map((name) => {
      const own = scored.find((r) => r.list === "candidates" && r.name === name)!;
      const best = scored.find((r) => r.list === "excerpts" && found[r.index]!.file === name);
      if (own.score >= search.fileFloor || !best || best.score <= own.score) return { name, score: own.score, by: "name" };
      return { name, score: Math.min(best.score, search.fileFloor - 0.01), by: `p.${found[best.index]!.excerpt.page}` };
    })
    .sort((a, b) => b.score - a.score);
  const ranked = all.slice(0, search.maxFiles);
  const above = all.filter((r) => r.score >= search.fileFloor).length;
  ui.log(
    `ranked ${paths.length} paths and ${found.length} excerpts in ${split(rankSnap)}, ` +
      `${above} above file floor ${search.fileFloor}` +
      (all.length > above ? ` (${all.length - above} below)` : ""),
  );

  const hits: Hit[] = [];
  const tried: Tried[] = [];
  const rejected: Candidate[] = [];
  const dropped: Candidate[] = [];
  let opened = 0;
  let below = false;

  for (const r of ranked) {
    // Unless hard, the floor is soft: a file that scored under it is opened
    // only while nothing has answered. "Which items cost more than 900 caps" says nothing a
    // filename can match, and the rulebook holding the answer scored 1.48.
    // Above the floor -n windows are collected; below it one is enough.
    if (r.score < search.fileFloor) {
      if (hard || hits.length > 0) break;
      if (!below) ui.log(`nothing above the file floor answered; opening files below it`);
      below = true;
    }
    const fileSnap = snapshot();
    const named = `${r.score.toFixed(2)}  ${r.name}${r.by === "name" ? "" : `  (by ${r.by})`}`;
    if (!r.name.toLowerCase().endsWith(".pdf")) {
      ui.log(`${named}  --  not a PDF, skipped`);
      continue;
    }
    if (!(await Bun.file(r.name).exists())) {
      ui.log(`${named}  --  no such file, skipped`);
      continue;
    }
    // mutool cannot open an empty file, and its failure mid-walk ended the run.
    if (Bun.file(r.name).size === 0) {
      ui.log(`${named}  --  empty file, skipped`);
      continue;
    }
    // A file names itself first; what it read stands under it and its sum closes it.
    ui.log(`${named}…`);
    opened++;
    // The answer budget spans files, so each file gets what the last one left.
    const res =
      search.kind === "table"
        ? await io.composeTable(client, r.name, search, ui, "  ")
        : await io.searchPdf(client, r.name, { ...search, maxAnswers: search.maxAnswers - rejected.length, hits: search.hits - hits.length }, ui, "  ");
    tried.push(...res.tried);
    rejected.push(...res.rejected);
    dropped.push(...res.dropped);
    ui.log(`file ${split(fileSnap)}  ${res.tried.length} windows read`);
    hits.push(...res.hits);
    if (hits.length >= search.hits || rejected.length >= search.maxAnswers) break;
  }
  return { hit: hits[0], hits, tried, rejected, dropped, opened, above, considered: ranked.length };
}

/** How sure jev must be that the rows name documents for a table to be built across them. */
export const ACROSS = 0.5;
/**
 * A row's name runs through words jev gives this much: it rates a title's
 * own words under even odds at times ("Legend" of "Legend in the Mist") and
 * the words around the titles near 0 (docs/tables.md).
 */
const ROW_GO = 0.2;

/** The documents a table's rows are for and the questions its columns ask of each, with jev's per-word reads. */
export type AcrossReading = { p: number; rows: string[]; columns: string[]; words: Word[]; row: number[]; column: number[] };

/**
 * Whether the question wants a table whose rows are documents on the shelf,
 * which documents, and what to ask of each, in one call. A row's name keeps
 * its joining words ("The Art of War") and a column its whole question ("how
 * many chapters are there").
 */
export async function readAcross(client: TypeSafeClient, question: string): Promise<AcrossReading> {
  const words = wordsOf(question);
  const res = await timed("api", () =>
    client.systemOne({
      state: { question, words: words.map((w) => w.word) },
      questions: {
        across: noul(
          "`question` wants a table whose rows are each a document or work on the shelf, named in it, with each column a " +
            "question asked of each of them; not a table of things listed inside one document.",
        ),
        ...Object.fromEntries(
          words.flatMap((w, i) => [
            [
              `r${i}`,
              noul(
                `\`words[${i}]\` ("${w.word}") is part of the name of one of the documents \`question\` wants a row for, such as ` +
                  '"Moby Dick" or "The Art of War". Not a word joining two names, not a word of an instruction.',
              ),
            ],
            [
              `q${i}`,
              noul(
                `\`words[${i}]\` ("${w.word}") is part of a question \`question\` wants asked of each row, such as "how many ` +
                  'chapters are there". Not the name of a row, not a word pointing at the rows ("for each row"), not an ' +
                  'instruction to make the table ("give me a table", "ask").',
              ),
            ],
          ]),
        ),
      },
    }),
  );
  const answers = res.answers as unknown as Record<string, { noul: number }>;
  const row = words.map((_, i) => answers[`r${i}`]!.noul);
  const column = words.map((_, i) => answers[`q${i}`]!.noul);
  return { p: answers.across!.noul, ...spansOf(words, row, column), words, row, column };
}

/**
 * The rows' names and the columns' questions a reading's per-word
 * probabilities make: a name is a run of words over ROW_GO, trimmed of
 * joining words at its ends; a question is a run of words jev is sure of,
 * "how" and all.
 */
export function spansOf(words: Word[], row: number[], column: number[]): { rows: string[]; columns: string[] } {
  const joining = (i: number) => STOPWORDS.has(words[i]!.word.toLowerCase());
  const text = (start: number, end: number) => words.slice(start, end + 1).map((w) => w.word).join(" ");
  const runs = (pass: (i: number) => boolean) => namesBy(words, pass, pass, { stop: () => false });
  const rows = runs((i) => row[i]! >= ROW_GO).flatMap((n) => {
    let [start, end] = [n.start, n.end];
    while (start < end && joining(start)) start++;
    while (end > start && joining(end)) end--;
    return joining(start) ? [] : [text(start, end)];
  });
  const columns = runs((i) => column[i]! >= 0.5).map((n) => n.name);
  return { rows, columns };
}

/** The question a cell asks: its column's question of its row's document, as a question about one book is put. */
export const cellQuestion = (row: string, column: string) => `${column} in ${row}?`;

/** A cell of a table across the shelf: its text, the hit it was read from, and why it has no answer when it has none. */
export type Cell = { text: string; kind: Kind; hit?: Hit; answer?: Answer; why?: string };
export type Across = { rows: string[]; columns: string[]; cells: Cell[][] };

/** Where a passage was found, as a cell shows it: the page and the section's own title. */
export function where(hit: Hit): string {
  const title = hit.section.split(" > ").pop() ?? "";
  // A book without an outline names its windows by page.
  return /^p\.\d+(-\d+)?$/.test(title) ? title : `p.${hit.page} ${title}`.trim();
}

/** A cell out of its walk: the value, or for a passage where it stands; N/A with the reason when nothing answered. */
export function cellOf(kind: Kind, r: Walked, o: FindOpts): Cell {
  const shown = (hit: Hit, answer: Answer) => (kind === "passage" ? where(hit) : answer.text);
  if (r.hit?.answer) return { text: shown(r.hit, r.hit.answer), kind, hit: r.hit, answer: r.hit.answer };
  if (r.rejected.length > 0) {
    const best = r.rejected.reduce((a, b) => (b.answer.p > a.answer.p ? b : a));
    return { text: NA, kind, hit: { ...best.hit, answer: best.answer }, answer: best.answer, why: `best ${shown(best.hit, best.answer)}, below ${o.answerFloor}` };
  }
  if (r.above === 0) return { text: NA, kind, why: `no file's name reached the file floor ${o.fileFloor}` };
  if (r.opened === 0) return { text: NA, kind, why: "no file above the file floor was a readable PDF" };
  return { text: NA, kind, why: `${r.opened} file${r.opened === 1 ? "" : "s"} opened, none answered` };
}

/** What acrossTable asks through; a test passes its own. */
export type AcrossIo = { answerLayer: typeof answerLayer; findIn: typeof findIn };
const ACROSS_IO: AcrossIo = { answerLayer, findIn };

/**
 * A table with a row for each named document and a column for each question,
 * each cell its question put of its row's document and walked over the whole
 * shelf. Cells run one after another, so each one's tokens are its own.
 */
export async function acrossTable(client: TypeSafeClient, paths: string[], o: FindOpts, rows: string[], columns: string[], ui: Ui, io: AcrossIo = ACROSS_IO): Promise<Across> {
  const cells: Cell[][] = [];
  for (const row of rows) {
    const line: Cell[] = [];
    for (const column of columns) {
      const cellSnap = snapshot();
      ui.log(`${row}: ${column}…`);
      const inner: Ui = { ...ui, log: (l) => ui.log(`  ${l}`) };
      // The table's own kind and -n are the request's, not the cell's.
      let search = await io.answerLayer<FindOpts>(client, { ...o, question: cellQuestion(row, column), kind: undefined, hits: 1 }, inner);
      if (search.kind === "table") {
        inner.log("a cell holds no table; read as a passage");
        search = { ...search, kind: "passage" };
      }
      const cell = cellOf(search.kind!, await io.findIn(client, paths, search, inner, { hard: true }), o);
      ui.log(`${row}: ${column}: ${cell.text}${cell.why ? ` (${cell.why})` : ` (p=${cell.answer!.p.toFixed(2)})`}  in ${split(cellSnap)}`);
      line.push(cell);
    }
    cells.push(line);
  }
  return { rows, columns, cells };
}

/** The table's rows under its heads, the first naming the row's document. */
export function acrossRows(t: Across): Row[] {
  const heads = ["name", ...t.columns];
  return t.rows.map((r, i) => ({ heads, cells: [r, ...t.cells[i]!.map((c) => c.text)] }));
}

/**
 * Prints a table across the shelf and exits: the grid, a line per cell
 * saying where it was read, and each passage cell's passage under its line.
 * 0 when any cell answered, 1 otherwise.
 */
export async function reportAcross(tool: string, t: Across, o: FindOpts, ui: Ui, since: Snapshot): Promise<never> {
  ui.clear();
  ui.log(`total ${split(since)}`);
  const tty = process.stdout.isTTY;
  const paras: Para[] = acrossRows(t).map((row) => ({ heading: false, text: rowText(row), style: "", lines: [], table: row }));
  if (!o.json) console.log(renderPassage(paras, process.stdout.columns, tty, o.tsv));
  // Piped as TSV, stdout is the table alone.
  const out = o.tsv && !tty ? console.error : console.log;
  const flat = t.cells.flatMap((line, i) => line.map((cell, j) => ({ cell, name: `${t.rows[i]}, ${t.columns[j]}` })));
  const found = flat.filter(({ cell }) => cell.hit && cell.answer);
  const marked = new Map((await highlightAll(found.map(({ cell }) => cell.hit!), o)).map((hit, i) => [found[i]!.cell, hit]));
  const answered = t.cells.flat().some((c) => !c.why);
  if (o.json) {
    const cells = await Promise.all(
      t.cells.map((line) =>
        Promise.all(line.map(async (c) => ({ text: c.text, kind: c.kind, why: c.why, hit: c.hit && c.answer ? await sizedHit({ ...c.hit, answer: c.answer }, marked.get(c)?.pdf) : undefined }))),
      ),
    );
    const message = answered ? undefined : "no cell answered";
    if (message) console.error(`${tool}: ${message}`);
    const report: JsonReport = { kind: "table", status: answered ? "answered" : "unanswered", hits: [], message, table: { rows: t.rows, columns: t.columns, cells }, spent: spentSince(since) };
    console.log(JSON.stringify(report));
    process.exit(answered ? 0 : 1);
  }
  if (tty) out("");
  for (const { cell, name } of flat) {
    const hit = marked.get(cell);
    if (!hit || !cell.answer) {
      out(`${name}: ${cell.why}`);
      continue;
    }
    out(`(p=${cell.answer.p.toFixed(2)}${cell.why ? `, ${cell.why}` : ""})  ${name}: ${hitLine(hit)}`);
    if (cell.kind === "passage" && cell.answer.passage) out(`${tty ? "\n" : ""}${renderPassage(cell.answer.passage, process.stdout.columns, tty)}${tty ? "\n" : ""}`);
  }
  const first = found.find(({ cell }) => !cell.why);
  if (o.open && first) {
    const hit = marked.get(first.cell)!;
    await openAt(pageUrl(hit.pdf, hit.page));
  }
  if (!answered) {
    console.error(`${tool}: no cell answered`);
    process.exit(1);
  }
  process.exit(0);
}

/** A table's rows matched to the true rows by name, for the bench: each true row scored by `score` of its first cell, a row not read scoring 0. */
export function scoreRows(t: Across, truth: Record<string, number>, score: (got: string, want: number) => number): number {
  const at = new Map(t.rows.map((r, i) => [normalize(r), i]));
  const rows = Object.entries(truth);
  return rows.reduce((s, [name, want]) => {
    const i = at.get(normalize(name));
    return s + (i === undefined ? 0 : score(t.cells[i]![0]!.text, want));
  }, 0) / Math.max(1, rows.length);
}
