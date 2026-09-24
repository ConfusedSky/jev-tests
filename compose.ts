/**
 * A table built to the question's own design: "a row for each standard
 * ranged weapon with its damage, weapon skill and drum magazine size". The
 * rows and whatever columns their table holds come from one passage search
 * for the rows' table, asked without the columns, which no one page holds;
 * a column still missing is read from each row's own entry on the pages
 * after the table ("Ammunition: .44 Magnum" under ".44 PISTOL"), then
 * searched for as a table of its own, whose rows are matched to ours by
 * name; a value none of those hold is read from our row's own cells ("M
 * Pistol" out of "12 (M Pistol)"), and anything left is N/A. The result is a passage of table rows, so it prints, pipes and
 * highlights as one.
 */
import { choice, noul, type TypeSafeClient } from "@typesafe-ai/sdk";
import { columnsFor, namesFrom, normalize, STOPWORDS, wordsOf, type Answer, type Reading } from "./answer";
import { answerLayer, type ReadOpts } from "./cli";
import { lone, pageParagraphs, rowText, type Box, type Para } from "./layout";
import { pageCount, searchPdf, type Hit, type Outcome, type Ui } from "./pdf";
import { timed } from "./shared";

export const NA = "N/A";

/** Passages a missing column's search collects before its tables are asked which holds it. */
const COLUMN_HITS = 3;

/** Pages from the rows' table on that are read for an entry per row. */
const ENTRY_PAGES = 8;

/** A value a cell may take, what it was read out of, and where that stands on the page. */
export type Piece = { text: string; from: string; lines: Box[] };

/** A table a passage holds: its heads and its rows, each with the boxes of its cells. */
export type Found = { heads: string[]; rows: { cells: string[]; lines: Box[] }[]; hit: Hit };

/** The tables in a hit's passage, notes under rows left out, in the order they appear. */
export function tablesIn(hit: Hit): Found[] {
  const out = new Map<string, Found>();
  for (const p of hit.answer?.passage ?? []) {
    if (!p.table || lone(p.table)) continue;
    const key = p.table.heads.join("\t");
    if (!out.has(key)) out.set(key, { heads: p.table.heads, rows: [], hit });
    out.get(key)!.rows.push({ cells: p.table.cells, lines: p.lines });
  }
  return [...out.values()];
}

/** For each of `ours`, the index of the row of `theirs` with the same name, ignoring case and punctuation. */
export function sameNames(ours: string[], theirs: string[]): (number | undefined)[] {
  const at = new Map(theirs.map((n, i) => [normalize(n), i]));
  return ours.map((n) => at.get(normalize(n)));
}

/**
 * Each row's entry among `paras`: the paragraphs under a heading that is
 * the row's name, ignoring case and punctuation (".44 PISTOL" for ".44
 * Pistol"), up to the next heading. Keyed by row.
 */
export function entriesOf(paras: Para[], names: string[]): Map<number, Para[]> {
  const want = new Map(names.map((n, i) => [normalize(n), i]));
  const out = new Map<number, Para[]>();
  let cur: Para[] | undefined;
  for (const p of paras) {
    if (p.heading) {
      const i = want.get(normalize(p.text));
      cur = i === undefined || out.has(i) ? undefined : [];
      if (cur) out.set(i!, cur);
    } else cur?.push(p);
  }
  return out;
}

/** An entry's labelled lines ("Ammunition: .44 Magnum") as the values it offers, each under its label. */
export function entryPieces(entry: Para[]): (Piece & { label: string })[] {
  return entry.flatMap((p) => {
    const m = /^[•\s]*([^:]{1,40}):\s*(\S.*)$/.exec(p.text);
    return m ? [{ label: m[1]!.trim(), text: m[2]!.trim(), from: p.text, lines: p.lines }] : [];
  });
}

/**
 * For each column, the label the entries give it under, or undefined: one
 * choice per column among the labels the entries share. Asked a row at a
 * time, "Ammunition: Flare" was no ammo type to jev at 0.3, while every
 * other gun's ammunition line was one.
 */
export async function labelsFor(client: TypeSafeClient, question: string, columns: string[], labels: string[]): Promise<(string | undefined)[]> {
  if (labels.length === 0 || columns.length === 0) return columns.map(() => undefined);
  const questions = Object.fromEntries(
    columns.map((c, j) => [
      `c${j}`,
      choice(`Under which label do the entries give each one's ${c}, that very thing and not something like it?`, {
        ...Object.fromEntries(labels.map((l, k) => [`l${k}`, `"${l}"`])),
        none: `No label gives the ${c}`,
      }),
    ]),
  );
  const res = await timed("api", () => client.systemOne({ state: { question }, questions }));
  return columns.map((_, j) => {
    const k = /^l(\d+)$/.exec((res.answers[`c${j}`] as { choice: string }).choice)?.[1];
    return k === undefined ? undefined : labels[Number(k)];
  });
}

/**
 * The pieces of a row's cells a value may be read from: each cell whole,
 * what stands before and inside its brackets, and its parts between bullets
 * and commas. "12 (M Pistol)" offers "12 (M Pistol)", "12" and "M Pistol".
 */
export function piecesOf(cells: string[]): { text: string; cell: number }[] {
  const out: { text: string; cell: number }[] = [];
  const seen = new Set<string>();
  const add = (text: string, cell: number) => {
    const t = text.replace(/^[\s•,;]+|[\s•,;]+$/g, "");
    if (t && !seen.has(t)) (seen.add(t), out.push({ text: t, cell }));
  };
  cells.forEach((c, cell) => {
    add(c, cell);
    const bracket = /^(.*?)\(([^)]*)\)(.*)$/.exec(c);
    if (bracket) for (const part of [bracket[1]!, bracket[2]!, bracket[3]!]) add(part, cell);
    for (const part of c.split(/\s*[•,;]\s*/)) add(part, cell);
  });
  return out;
}

/**
 * What the table is of and which columns it wants, read off the request a
 * word at a time. The question's own reading will not do: its quantities are
 * figures, and "ammo type" or "weapon skill" is not one.
 */
export async function readRequest(client: TypeSafeClient, question: string): Promise<{ things: string; columns: string[] }> {
  const words = wordsOf(question);
  const questions = Object.fromEntries(
    words.flatMap((w, i) => [
      [
        `r${i}`,
        noul(
          `\`words[${i}]\` ("${w.word}") is part of the name of the things \`question\` wants a row of the table for each of, ` +
            'such as "standard ranged weapons". Not a column, not the game, not a joining word.',
        ),
      ],
      [
        `c${i}`,
        noul(
          `\`words[${i}]\` ("${w.word}") is part of the name of a column \`question\` wants the table to have, ` +
            'such as "single shot damage" or "ammo type". Not the things the rows are for, not a joining word.',
        ),
      ],
    ]),
  );
  const res = await timed("api", () => client.systemOne({ state: { question, words: words.map((w) => w.word) }, questions }));
  const yes = (prefix: string) => (i: number) => (res.answers[`${prefix}${i}`] as { noul: number }).noul >= 0.5 && !/^(each|every|all)$/i.test(words[i]!.word);
  // The rows are the first name; its words are not columns too, though the
  // "standard" of "standard ranged weapons" reads like one.
  const rows = yes("r");
  const first = words.findIndex((w, i) => !STOPWORDS.has(w.word.toLowerCase()) && rows(i));
  let last = first;
  while (first >= 0 && last + 1 < words.length && !words[last]!.ends && !STOPWORDS.has(words[last + 1]!.word.toLowerCase()) && rows(last + 1)) last++;
  const things = first < 0 ? "" : words.slice(first, last + 1).map((w) => w.word).join(" ");
  const cols = yes("c");
  return { things, columns: namesFrom(words, (i) => (i < first || i > last) && cols(i), true) };
}

/** A search for a passage, its question and reading set here rather than asked of jev. */
async function passageSearch(client: TypeSafeClient, pdf: string, o: ReadOpts, ui: Ui, indent: string, question: string, subject: string[], hits = 1): Promise<Outcome> {
  const read: Reading = { kind: "passage", quantities: [], counted: "", subject, game: o.reading?.game ?? [] };
  const search = await answerLayer(client, { ...o, question, kind: "passage", hits, highlight: false }, { ...ui, log: () => {} }, read);
  return searchPdf(client, pdf, search, ui, indent);
}

export async function composeTable(client: TypeSafeClient, pdf: string, o: ReadOpts, ui: Ui, indent = ""): Promise<Outcome> {
  const { things, columns } = await readRequest(client, o.question);
  // Naming no columns, "show me the exotic weapons table" wants a table the
  // book prints, and jev reads it as one to be made now and then; the
  // table kind reads a page as a passage does, so the search runs as one.
  if (columns.length === 0) {
    ui.log(`${indent}no columns named; read as a passage`);
    return searchPdf(client, pdf, o, ui, indent);
  }
  ui.log(`${indent}table of ${things || "?"}: ${columns.join(", ")}`);
  const main = await passageSearch(client, pdf, o, ui, indent, `Show me the table of all the ${things}`, [things]);
  const first = main.hit && tablesIn(main.hit);
  if (!main.hit || !first?.length) {
    ui.log(`${indent}no table of ${things} found`);
    return { hits: [], tried: main.tried, rejected: main.rejected, dropped: main.hits.map((hit) => ({ hit, answer: hit.answer! })) };
  }
  const ours = first[0]!;
  ui.log(`${indent}rows: ${ours.rows.length} ${things} from p.${main.hit.page}`);

  // Each column comes from the first table that holds it, ours first.
  type Source = { table: Found; col: number };
  const sources: (Source | undefined)[] = columns.map(() => undefined);
  const place = async (tables: Found[], question: string, wanted: number[]) => {
    // A column no row fills is a gap the table's rules leave, not a column.
    const heads = tables.map((t) => t.heads.map((h, c) => (t.rows.some((r) => r.cells[c]) ? h : "")));
    const cols = await columnsFor(client, question, wanted.map((j) => columns[j]!), heads);
    wanted.forEach((j, k) => {
      const t = cols.findIndex((c) => c[k] !== undefined);
      if (t >= 0 && !sources[j]) sources[j] = { table: tables[t]!, col: cols[t]![k]! };
    });
  };
  await place(first, o.question, columns.map((_, j) => j));
  const names = ours.rows.map((r) => r.cells[0] ?? "");
  const unplaced = () => columns.flatMap((_, j) => (sources[j] ? [] : [j]));

  // A value an entry states outright is read before any search: Fallout
  // gives each gun's ammunition under its heading, in no table.
  const read = new Map<string, Piece>();
  const byEntry = new Set<number>();
  if (unplaced().length) {
    const from = Math.max(main.hit.page, ...ours.rows.flatMap((r) => r.lines.map((l) => l.page)));
    const to = Math.min(await pageCount(pdf), from + ENTRY_PAGES);
    const paras = (await Promise.all(Array.from({ length: to - from + 1 }, (_, k) => pageParagraphs(pdf, from + k)))).flat();
    const entries = entriesOf(paras, names);
    const pieces = new Map([...entries].map(([i, entry]) => [i, entryPieces(entry)]));
    // A label counts once however many entries give it.
    const labels = [...new Map([...pieces.values()].flat().map((p) => [normalize(p.label), p.label])).values()];
    const wanted = unplaced();
    const found = await labelsFor(client, o.question, wanted.map((j) => columns[j]!), labels);
    wanted.forEach((j, k) => {
      const label = found[k];
      if (label === undefined) return;
      byEntry.add(j);
      for (const [i, ps] of pieces) {
        const piece = ps.find((p) => normalize(p.label) === normalize(label));
        if (piece) read.set(`${i} ${j}`, piece);
      }
    });
    ui.log(`${indent}entries: ${entries.size} of ${names.length} ${things} on p.${from}-${to}`);
  }

  const missing = unplaced().filter((j) => !byEntry.has(j));
  const tried = [...main.tried];
  const seen = [...first];
  await Promise.all(
    missing.map(async (j) => {
      const q = `What is the ${columns[j]} of each of the ${things}?`;
      // A column's first passage is often the rows' own table again, which
      // lacks it; the drum sizes stand two pages on, in the clip chart.
      const r = await passageSearch(client, pdf, o, ui, `${indent}  `, q, [columns[j]!], COLUMN_HITS);
      tried.push(...r.tried);
      const found = r.hits.flatMap(tablesIn).filter((t) => !first.some((f) => f.heads.join("\t") === t.heads.join("\t")));
      seen.push(...found);
      await place(found, q, [j]);
    }),
  );
  // A column's own search may land elsewhere while another's found its
  // table: the drum magazine column stands beside the extended one.
  const still = unplaced().filter((j) => !byEntry.has(j));
  const others = seen.filter((t) => !first.includes(t));
  if (still.length && others.length) await place(others, o.question, still);
  for (const [j, s] of sources.entries())
    ui.log(`${indent}  ${columns[j]}: ${s ? `"${s.table.heads[s.col]}" p.${s.table.hit.page}` : byEntry.has(j) ? "each entry's label" : "not in a table"}`);

  const matches = new Map<Found, (number | undefined)[]>();
  for (const s of sources) if (s && s.table !== ours && !matches.has(s.table)) matches.set(s.table, await matchRows(client, o.question, names, s.table));
  const fromCells = unplaced().filter((j) => !byEntry.has(j));
  for (const [k, v] of await deriveCells(client, o.question, ours, fromCells.map((j) => ({ column: columns[j]!, j })))) read.set(k, v);

  const heads = [ours.heads[0]!, ...columns];
  const passage: Para[] = ours.rows.map((row, i) => {
    const lines: Box[] = row.lines.filter((l) => l.cell === undefined || l.cell === 0);
    const cells = [
      names[i]!,
      ...columns.map((_, j) => {
        const piece = read.get(`${i} ${j}`);
        if (piece) {
          lines.push(...piece.lines);
          return piece.text;
        }
        const s = sources[j];
        const r = !s ? undefined : s.table === ours ? i : matches.get(s.table)![i];
        const from = s && r !== undefined ? s.table.rows[r] : undefined;
        const cell = from?.cells[s!.col];
        if (!cell) return NA;
        lines.push(...from!.lines.filter((l) => l.cell === s!.col));
        return cell;
      }),
    ];
    const table = { heads, cells };
    const text = rowText(table);
    return { heading: false, text, style: " ".repeat(text.length), lines: lines.map((l) => ({ ...l, start: 0, end: text.length })), table };
  });
  const answer: Answer = { text: passage.map((p) => p.text).join("\n"), p: main.hit.answer!.p, pages: [...new Set(passage.flatMap((p) => p.lines.map((l) => l.page)))], passage };
  const hit: Hit = { ...main.hit, answer };
  return { hit, hits: [hit], tried, rejected: [], dropped: [] };
}

/**
 * For each of our row names, the row of `theirs` that is the same thing:
 * the same name first, then jev for the rest, one choice per row among
 * their unmatched names or none.
 */
export async function matchRows(client: TypeSafeClient, question: string, names: string[], theirs: Found): Promise<(number | undefined)[]> {
  const their = theirs.rows.map((r) => r.cells[0] ?? "");
  const found = sameNames(names, their);
  const free = their.flatMap((n, i) => (found.includes(i) ? [] : [{ n, i }]));
  const left = found.flatMap((f, i) => (f === undefined ? [i] : []));
  if (left.length === 0 || free.length === 0) return found;
  const questions = Object.fromEntries(
    left.map((i) => [
      `r${i}`,
      choice(`Which row of the other table is the same thing as "${names[i]}"?`, {
        ...Object.fromEntries(free.map(({ n, i: k }) => [`o${k}`, `The row "${n}"`])),
        none: "None of them is",
      }),
    ]),
  );
  const res = await timed("api", () => client.systemOne({ state: { question }, questions }));
  for (const i of left) {
    const c = /^o(\d+)$/.exec((res.answers[`r${i}`] as { choice: string }).choice)?.[1];
    if (c !== undefined) found[i] = Number(c);
  }
  return found;
}

/**
 * Values no column holds, read from each row's own cells: for every row and
 * missing column, one choice among the pieces of the row's other cells, or
 * none. Keyed "row column".
 */
export async function deriveCells(client: TypeSafeClient, question: string, ours: Found, missing: { column: string; j: number }[]): Promise<Map<string, Piece>> {
  const asks = ours.rows.flatMap((r, i) => {
    const pieces = piecesOf(r.cells.slice(1)).map((p) => ({ text: p.text, from: r.cells[p.cell + 1]!, lines: r.lines.filter((l) => l.cell === p.cell + 1) }));
    const row = rowText({ heads: ours.heads, cells: r.cells });
    return pieces.length === 0 ? [] : missing.map(({ column, j }) => ({ key: `${i} ${j}`, prompt: `Which part of the row for "${r.cells[0]}" (${row}) states its ${column}?`, column, pieces }));
  });
  return choosePieces(client, question, asks);
}

/** For each ask, the piece it picks, or none; all in one call, keyed by the ask's key. */
export async function choosePieces(
  client: TypeSafeClient,
  question: string,
  asks: { key: string; prompt: string; column: string; pieces: Piece[] }[],
): Promise<Map<string, Piece>> {
  const out = new Map<string, Piece>();
  if (asks.length === 0) return out;
  const questions = Object.fromEntries(
    asks.map((a, n) => [
      `a${n}`,
      choice(a.prompt, {
        ...Object.fromEntries(a.pieces.map((p, k) => [`p${k}`, p.from === p.text ? `"${p.text}"` : `"${p.text}", from "${p.from}"`])),
        none: `None states its ${a.column}`,
      }),
    ]),
  );
  const res = await timed("api", () => client.systemOne({ state: { question }, questions }));
  asks.forEach((a, n) => {
    const k = /^p(\d+)$/.exec((res.answers[`a${n}`] as { choice: string }).choice)?.[1];
    if (k !== undefined) out.set(a.key, a.pieces[Number(k)]!);
  });
  return out;
}
