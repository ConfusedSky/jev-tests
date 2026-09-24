/**
 * A table built to the question's own design: "a row for each standard
 * ranged weapon with its damage, weapon skill and drum magazine size". The
 * rows and whatever columns their table holds come from one passage search
 * for the rows' table, asked without the columns, which no one page holds;
 * a column still missing is read from each row's own entry on the pages
 * after the table ("Ammunition: .44 Magnum" under ".44 PISTOL"), then
 * searched for as a table of its own, whose rows are matched to ours by
 * name; a value none of those hold is read from our row's own cells ("M
 * Pistol" out of "12 (M Pistol)"), and anything left is N/A. The result
 * is a passage of table rows, so it prints, pipes and highlights as one.
 */
import { choice, noul, type TypeSafeClient } from "@typesafe-ai/sdk";
import { columnsFor, normalize, singular, STOPWORDS, wordsOf, type Answer, type Reading, type Word } from "./answer";
import { answerLayer, type ReadOpts } from "./cli";
import { lone, pageParagraphs, rowText, type Box, type Para } from "./layout";
import { pageCount, searchPdf, type Hit, type Outcome, type Ui } from "./pdf";
import { snapshot, split, timed } from "./shared";

export const NA = "N/A";

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** Passages a missing column's search collects before its tables are asked which holds it. */
const COLUMN_HITS = 3;

/** Pages from the rows' table on that are read for an entry per row. */
const ENTRY_PAGES = 8;

/** A value a cell may take, what it was read out of, and where that stands on the page. */
export type Piece = { text: string; from: string; lines: Box[] };

/** A table a passage holds: its heads and its rows, each with the boxes of its cells. */
export type Found = { heads: string[]; rows: { cells: string[]; lines: Box[]; group?: string }[]; hit: Hit };

/**
 * The tables in a hit's passage, notes under rows left out, in the order
 * they appear. A heading or prose between rows ends a table, though the next
 * has the same heads: Fallout sets its small guns and energy weapons under
 * one header. Rows left out between two runs of one table do not.
 */
export function tablesIn(hit: Hit): Found[] {
  return tablesFrom(hit.answer?.passage ?? [], hit);
}

/** The tables among `paras`, as tablesIn reads a passage's, each found on the page its first row stands on. */
export function tablesFrom(paras: Para[], hit: Hit): Found[] {
  const out: Found[] = [];
  let cur: Found | undefined;
  // A row of one cell over rows ("BARREL MODS") names their group.
  let group: string | undefined;
  let page = hit.page;
  for (const p of paras) {
    page = p.lines[0]?.page ?? page;
    if (!p.table) {
      if (p.text !== "…") cur = group = undefined;
      continue;
    }
    if (lone(p.table)) {
      group = p.table.cells.find(Boolean);
      continue;
    }
    if (!cur || cur.heads.join("\t") !== p.table.heads.join("\t")) out.push((cur = { heads: p.table.heads, rows: [], hit: { ...hit, page } }));
    cur.rows.push({ cells: p.table.cells, lines: p.lines, ...(group && { group }) });
  }
  return out;
}

/** A cell's boxes, or the row's whole box when it was read without cell boxes. */
const boxesOf = (row: { lines: Box[] }, cell: number) => row.lines.filter((l) => l.cell === cell || l.cell === undefined);

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
 * choice per column among the labels the entries share, so every row reads
 * the same line. Asked a row at a time, jev doubted a value that was odd
 * for its kind ("Ammunition: Flare") where it took the same line elsewhere.
 */
export async function labelsFor(client: TypeSafeClient, question: string, columns: string[], labels: string[]): Promise<(string | undefined)[]> {
  if (labels.length === 0 || columns.length === 0) return columns.map(() => undefined);
  const questions = Object.fromEntries(
    columns.map((c, j) => [
      `c${j}`,
      choice(`Under which label do the entries give each one's ${c}, that very thing and not something like it?`, {
        // A choice takes at most 255 options.
        ...Object.fromEntries(labels.slice(0, 254).map((l, k) => [`l${k}`, `"${l}"`])),
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
    if (t && !seen.has(`${cell}\t${t}`)) (seen.add(`${cell}\t${t}`), out.push({ text: t, cell }));
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
 * Names as runs of words: a run starts at a word `start` passes and goes on
 * through words `go` passes, a joining word never starting or standing inside
 * one; a comma or full stop ends it. With `of`, an "of" between two such words
 * stays inside ("rate of fire"). Each name keeps its first and last word's index.
 */
export function namesBy(words: Word[], start: (i: number) => boolean, go: (i: number) => boolean, of = false): { name: string; start: number; end: number }[] {
  const out: { name: string; start: number; end: number }[] = [];
  const stop = (i: number) => STOPWORDS.has(words[i]!.word.toLowerCase());
  let i = 0;
  while (i < words.length) {
    if (stop(i) || !start(i)) {
      i++;
      continue;
    }
    let end = i;
    for (;;) {
      if (words[end]!.ends || end + 1 >= words.length) break;
      const next = end + 1;
      if (!stop(next) && go(next)) end = next;
      else if (of && words[next]!.word.toLowerCase() === "of" && next + 1 < words.length && !stop(next + 1) && go(next + 1)) end = next + 1;
      else break;
    }
    out.push({ name: words.slice(i, end + 1).map((w) => w.word).join(" "), start: i, end });
    i = end + 1;
  }
  return out;
}

/**
 * What the table is of, its columns, and what to add beside each item of
 * some of them: "for each Mod column add the cost of the mod in
 * parenthesis" adds `add: "cost"` to the columns named in `annotated`.
 */
export type Request = { things: string; columns: string[]; add?: string; annotated: number[] };

/**
 * What the table is of, which columns it wants and what to add to them, read
 * off the request a word at a time. The question's own reading will not do:
 * its quantities are figures, and "ammo type" or "weapon skill" is not one.
 */
export function readRequest(client: TypeSafeClient, question: string): Promise<Request> {
  // jevfind composes a table per file; the request reads the same in each.
  // A reading that failed is not kept, so the next file asks again.
  let r = requests.get(question);
  if (!r) {
    requests.set(question, (r = readRequestOnce(client, question)));
    r.catch(() => requests.delete(question));
  }
  return r;
}
const requests = new Map<string, Promise<Request>>();

async function readRequestOnce(client: TypeSafeClient, question: string): Promise<Request> {
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
            'such as "single shot damage" or "ammo type". Not the things the rows are for, not a word of an instruction about ' +
            'what to add to the columns ("for each Mod column add the cost"), not a joining word.',
        ),
      ],
      [
        `a${i}`,
        noul(
          `\`words[${i}]\` ("${w.word}") is part of the name of what \`question\` asks to add beside each item of some columns, ` +
            'such as "cost" in "add the cost of the mod in parenthesis". Not the kind of column it is added to ("Mod" in ' +
            '"each Mod column"), not the item it is of ("the mod"), not how it is written ("in parenthesis"), not a column, ' +
            "not the things the rows are for, not a joining word.",
        ),
      ],
    ]),
  );
  const res = await timed("api", () => client.systemOne({ state: { question, words: words.map((w) => w.word) }, questions }));
  const p = (prefix: string, i: number) => (res.answers[`${prefix}${i}`] as { noul: number }).noul;
  const quantifier = (i: number) => /^(each|every|all)$/i.test(words[i]!.word);
  // A name starts at a word jev is sure of and runs on through words it
  // half believes: "guns" of "small guns" and "Mods" of "Barrel Mods" sit
  // either side of even odds from one reading to the next.
  const rowsIn = namesBy(words, (i) => p("r", i) >= 0.5 && !quantifier(i), (i) => p("r", i) >= 0.3);
  const things = rowsIn[0]?.name ?? "";
  const inRows = (i: number) => rowsIn[0] !== undefined && i >= rowsIn[0].start && i <= rowsIn[0].end;
  // A word of the instruction starts no column, though "Mod" in "each Mod
  // column" reads like one; inside a column's name ("Barrel Mods") it stays.
  const columns = namesBy(
    words,
    (i) => !inRows(i) && p("c", i) >= 0.5 && p("c", i) >= p("a", i),
    (i) => !inRows(i) && p("c", i) >= 0.3,
    true,
  ).map((n) => n.name);
  // Of the names read as what to add, the one jev is surest of.
  const adds = namesBy(words, (i) => !inRows(i) && p("a", i) >= 0.5 && p("a", i) >= p("c", i), (i) => !inRows(i) && p("a", i) >= 0.3, true);
  const surest = (n: { start: number; end: number }) => Math.max(...words.slice(n.start, n.end + 1).map((_, k) => p("a", n.start + k)));
  const add = adds.sort((x, y) => surest(y) - surest(x))[0]?.name;
  if (!add || columns.length === 0) return { things, columns, annotated: [] };
  const which = await timed("api", () =>
    client.systemOne({
      state: { question },
      questions: Object.fromEntries(columns.map((c, j) => [`k${j}`, noul(`\`question\` asks to add the ${add} beside each item of the "${c}" column.`)])),
    }),
  );
  const annotated = columns.flatMap((_, j) => ((which.answers[`k${j}`] as { noul: number }).noul >= 0.5 ? [j] : []));
  return { things, columns, add: annotated.length ? add : undefined, annotated };
}

/** A search for a passage, its question and reading set here rather than asked of jev. */
async function passageSearch(client: TypeSafeClient, pdf: string, o: ReadOpts, ui: Ui, indent: string, question: string, subject: string[], hits = 1): Promise<Outcome> {
  const read: Reading = { kind: "passage", quantities: [], counted: "", subject, game: o.reading?.game ?? [] };
  const search = await answerLayer(client, { ...o, question, kind: "passage", hits, highlight: false }, { ...ui, log: () => {} }, read);
  return searchPdf(client, pdf, search, ui, indent);
}

export async function composeTable(client: TypeSafeClient, pdf: string, o: ReadOpts, ui: Ui, indent = ""): Promise<Outcome> {
  // Each step says what it took and spent. One with lines of its own names
  // itself first and sums up after them, so what is indented under it is
  // part of its sum. Several columns' lookups run side by side on one count
  // of tokens, so that step is timed whole.
  let step = snapshot();
  const begin = (what: string) => {
    ui.log(`${indent}${what}…`);
    step = snapshot();
  };
  const took = () => {
    const t = split(step);
    step = snapshot();
    return t;
  };
  const { things, columns, add, annotated } = await readRequest(client, o.question);
  // Naming no columns, "show me the exotic weapons table" wants a table the
  // book prints, and jev reads it as one to be made now and then; the
  // table kind reads a page as a passage does, so the search runs as one.
  if (columns.length === 0 || !things) {
    ui.log(`${indent}${columns.length ? "no rows" : "no columns"} named; read as a passage`);
    return searchPdf(client, pdf, o, ui, indent);
  }
  ui.log(`${indent}table of ${things}: ${columns.join(", ")}${add ? `, ${add} beside each ${annotated.map((j) => columns[j]).join(", ")} item` : ""}  in ${took()}`);
  begin(`rows: finding the table of ${things}`);
  const main = await passageSearch(client, pdf, o, ui, `${indent}  `, `Show me the table of all the ${things}`, [things]);
  const first = main.hit && tablesIn(main.hit);
  if (!main.hit || !first?.length) {
    ui.log(`${indent}no table of ${things} found  in ${took()}`);
    return { hits: [], tried: main.tried, rejected: main.rejected, dropped: main.hits.map((hit) => ({ hit, answer: hit.answer! })) };
  }
  const picking = snapshot();
  const ours = first.length === 1 ? first[0]! : await pickTable(client, o.question, things, first);
  if (first.length > 1) ui.log(`${indent}  of ${count(first.length, "table")}, the one with a row for each: ${ours.heads.join(", ")}  in ${split(picking)}`);
  ui.log(`${indent}rows: ${ours.rows.length} ${things} from p.${main.hit.page}  in ${took()}`);

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
  ui.log(`${indent}columns in the rows' table: ${sources.filter(Boolean).length} of ${columns.length}  in ${took()}`);
  const names = ours.rows.map((r) => r.cells[0] ?? "");
  const unplaced = () => columns.flatMap((_, j) => (sources[j] ? [] : [j]));

  // A value an entry states outright is read before any search: Fallout
  // gives each gun's ammunition under its heading, in no table.
  const read = new Map<string, Piece>();
  const byEntry = new Set<number>();
  // The pages from the rows' table on, where the entries and their tables stand.
  const from = Math.max(main.hit.page, ...ours.rows.flatMap((r) => r.lines.map((l) => l.page)));
  let near: Promise<{ to: number; paras: Para[] }> | undefined;
  const nearby = () =>
    (near ??= (async () => {
      const to = Math.min(await pageCount(pdf), from + ENTRY_PAGES);
      return { to, paras: (await Promise.all(Array.from({ length: to - from + 1 }, (_, k) => pageParagraphs(pdf, from + k)))).flat() };
    })());
  if (unplaced().length) {
    const { to, paras } = await nearby();
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
    ui.log(`${indent}entries: ${entries.size} of ${names.length} ${things} on p.${from}-${to}, ${count(byEntry.size, "column")} from them  in ${took()}`);
  }

  const missing = unplaced().filter((j) => !byEntry.has(j));
  if (missing.length) begin(`columns: searching for ${missing.map((j) => columns[j]).join(", ")}`);
  const tried = [...main.tried];
  const seen = [...first];
  // One column at a time, so each search's lines sum only its own calls.
  for (const j of missing) {
    const q = `What is the ${columns[j]} of each of the ${things}?`;
    const searching = snapshot();
    ui.log(`${indent}  ${columns[j]}: searching…`);
    // A column's first passage is often the rows' own table again, which
    // lacks it; the drum sizes stand two pages on, in the clip chart.
    const r = await passageSearch(client, pdf, o, ui, `${indent}    `, q, [columns[j]!], COLUMN_HITS);
    tried.push(...r.tried);
    // A table two searches both found is offered once.
    const same = (a: Found, b: Found) => a.heads.join("\t") === b.heads.join("\t") && a.rows[0]?.cells[0] === b.rows[0]?.cells[0];
    const found = r.hits.flatMap(tablesIn).filter((t) => !first.some((f) => f.heads.join("\t") === t.heads.join("\t")) && !seen.some((f) => same(f, t)));
    seen.push(...found);
    const picking = snapshot();
    await place(found, q, [j]);
    ui.log(`${indent}    column: ${sources[j] ? `"${sources[j]!.table.heads[sources[j]!.col]}" p.${sources[j]!.table.hit.page}` : `none of ${count(found.length, "table")} holds it`}  in ${split(picking)}`);
    ui.log(`${indent}  ${columns[j]}: searched  in ${split(searching)}`);
  }
  // A column's own search may land elsewhere while another's found its
  // table: the drum magazine column stands beside the extended one.
  const still = unplaced().filter((j) => !byEntry.has(j));
  const others = seen.filter((t) => !first.includes(t));
  if (still.length && others.length) {
    const pooling = snapshot();
    await place(others, o.question, still);
    ui.log(`${indent}  every table found, asked again for ${still.map((j) => columns[j]).join(", ")}  in ${split(pooling)}`);
  }
  if (missing.length) ui.log(`${indent}columns: searched for ${count(missing.length, "column")}  in ${took()}`);

  begin(`cells: filling ${names.length * columns.length}`);
  for (const [j, s] of sources.entries())
    ui.log(`${indent}  ${columns[j]}: ${s ? `"${s.table.heads[s.col]}" p.${s.table.hit.page}` : byEntry.has(j) ? "each entry's label" : "not in a table; from the rows' own cells"}`);

  const matches = new Map<Found, (number | undefined)[]>();
  for (const s of sources) if (s && s.table !== ours && !matches.has(s.table)) matches.set(s.table, await matchRows(client, o.question, names, s.table));
  // What a table holds for each row, then what the row's own cells state
  // wherever that left a gap: a row the entries or another table lack.
  const cellOf = (i: number, j: number): Piece | undefined => {
    const s = sources[j];
    const r = !s ? undefined : s.table === ours ? i : matches.get(s.table)![i];
    const from = s && r !== undefined ? s.table.rows[r] : undefined;
    const cell = from?.cells[s!.col];
    return cell ? { text: cell, from: cell, lines: boxesOf(from!, s!.col) } : undefined;
  };
  for (const [i] of names.entries())
    for (const [j] of columns.entries()) {
      const c = !read.has(`${i} ${j}`) && cellOf(i, j);
      if (c) read.set(`${i} ${j}`, c);
    }
  const gaps = names.flatMap((_, i) => columns.flatMap((column, j) => (read.has(`${i} ${j}`) ? [] : [{ row: i, j, column }])));
  for (const [k, v] of await deriveCells(client, o.question, ours, gaps)) read.set(k, v);
  ui.log(`${indent}cells: ${read.size} of ${names.length * columns.length} filled, ${count(matches.size, "other table")} matched by row, ${count(gaps.length, "gap")} looked for in the rows' own cells  in ${took()}`);
  if (read.size === 0) ui.log(`${indent}no column found for any ${things}`);

  if (add && annotated.length) {
    // The tables near the rows, nearest first; ours holds no item of its own cells.
    const tables = tablesFrom((await nearby()).paras, main.hit)
      .filter((t) => t.heads.join("\t") !== ours.heads.join("\t"))
      .sort((a, b) => Math.abs(a.hit.page - from) - Math.abs(b.hit.page - from));
    begin(`${add}: looking up beside each item of ${annotated.map((j) => columns[j]).join(", ")}`);
    // Each column is looked up on its own: a barrel's "Short" is no sight's
    // "Short Scope", and the same text in two columns may be two things.
    await Promise.all(
      annotated.map(async (j) => {
        const items = [...new Set(names.flatMap((_, i) => itemsOf(read.get(`${i} ${j}`)?.text ?? "").filter((it) => !placeholder(it))))];
        const values = await annotate(client, o.question, add, columns[j]!, items, tables);
        ui.log(`${indent}  ${columns[j]}: ${values.size} of ${items.length} items found`);
        for (const [i] of names.entries()) {
          const piece = read.get(`${i} ${j}`);
          if (piece) read.set(`${i} ${j}`, withValues(piece, values));
        }
      }),
    );
    ui.log(`${indent}${add}: looked up for ${count(annotated.length, "column")}  in ${took()}`);
  }

  const heads = [ours.heads[0]!, ...columns];
  const passage: Para[] = ours.rows.map((row, i) => {
    const lines: Box[] = boxesOf(row, 0);
    const cells = [
      names[i]!,
      ...columns.map((_, j) => {
        const piece = read.get(`${i} ${j}`);
        if (!piece) return NA;
        lines.push(...piece.lines);
        return piece.text;
      }),
    ];
    const table = { heads, cells };
    const text = rowText(table);
    return { heading: false, text, style: " ".repeat(text.length), lines: lines.map((l) => ({ ...l, start: 0, end: text.length })), table };
  });
  const answer: Answer = { text: passage.map((p) => p.text).join("\n"), p: main.hit.answer!.p, pages: [...new Set(passage.flatMap((p) => p.lines.map((l) => l.page)))], passage };
  const hit: Hit = { ...main.hit, answer };
  // A table of names and N/A answers nothing; it is shown as the best found.
  if (read.size === 0) return { hits: [], tried, rejected: [{ hit, answer: { ...answer, p: 0 } }], dropped: [] };
  return { hit, hits: [hit], tried, rejected: [], dropped: [] };
}

/** A cell's items: its parts between commas, semicolons and bullets. */
export function itemsOf(cell: string): string[] {
  return cell
    .split(/\s*[,;•]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Whether a row names `item`, the one or the other short by its group's
 * noun: "Long" under "BARREL MODS" is "Long Barrel", and a gun's entry's
 * "Marksman's" is the row "Marksman's Stock".
 */
export function namedAs(row: { cells: string[]; group?: string }, item: string): boolean {
  const name = normalize(row.cells[0] ?? "");
  const noun = normalize(row.group ?? "").replace(/\s*\bmods?\b\s*/g, " ").trim();
  const want = normalize(item);
  if (name === "" || want === "") return false;
  if (want === name) return true;
  return noun !== "" && [noun, singular(noun)].some((n) => want === `${name} ${n}` || name === `${want} ${n}`);
}

/** A cell's text that stands for no value: "None", "N/A", a dash. */
export const placeholder = (text: string) => /^(none|n a|na|)$/.test(normalize(text));

/** A cell with its items' values beside them, "Reflex Sight (+14)", marked where each came from; a placeholder cell is left as it is. */
export function withValues(piece: Piece, values: Map<string, Piece>): Piece {
  const items = itemsOf(piece.text);
  if (items.every(placeholder)) return piece;
  const parts = items.map((it) => ({ it, v: values.get(it) }));
  return {
    text: parts.map(({ it, v }) => (placeholder(it) ? it : `${it} (${v?.text || NA})`)).join(", "),
    from: piece.from,
    lines: [...piece.lines, ...parts.flatMap(({ v }) => v?.lines ?? [])],
  };
}

/**
 * For each item of `column`, its `add` from the nearest of `tables`
 * (nearest first) that names it and holds an `add` column: the same mod
 * costs differently in a weapon's own table further on. Where a table's
 * rows fall in groups ("BARREL MODS", "SIGHT MODS") only the group jev
 * picks for the column is looked in. A table under a group may shorten
 * its names by the group's noun ("Long" under "BARREL MODS" is "Long
 * Barrel"); an item named neither way is N/A rather than a guess, since
 * only its name ties it to a row ("Short" is no "Sawed-Off").
 */
export async function annotate(client: TypeSafeClient, question: string, add: string, column: string, items: string[], tables: Found[]): Promise<Map<string, Piece>> {
  const out = new Map<string, Piece>();
  if (items.length === 0 || tables.length === 0) return out;
  const groups = [...new Set(tables.flatMap((t) => t.rows.flatMap((r) => (r.group ? [r.group] : []))))];
  // Asked of the table's own rows, not the question's: the question has a
  // Cost column of its own, the gun's, and "the cost it asks for" is that.
  const asked: [string, ReturnType<typeof choice>][] = tables.map((t, k) => [
    `t${k}`,
    choice(`Which column of the table headed "${t.heads.join(", ")}" gives the ${add} of each of its rows (${t.rows.slice(0, 3).map((r) => `"${r.cells[0]}"`).join(", ")})?`, {
      ...Object.fromEntries(t.heads.flatMap((h, c) => (c > 0 && t.rows.some((r) => r.cells[c]) ? [[`c${c}`, `The column headed "${h}"`]] : []))),
      none: `No column gives the ${add}`,
    }),
  ]);
  if (groups.length > 1)
    asked.push([
      "group",
      choice(`Which group of rows lists the ${column} (such as ${items.slice(0, 3).map((it) => `"${it}"`).join(", ")})?`, {
        // A choice takes at most 255 options.
        ...Object.fromEntries(groups.slice(0, 254).map((g, k) => [`g${k}`, `The rows under "${g}"`])),
        none: "No one group",
      }),
    ]);
  const res = await timed("api", () => client.systemOne({ state: { question }, questions: Object.fromEntries(asked) }));
  const g = groups.length > 1 ? /^g(\d+)$/.exec((res.answers.group as { choice: string }).choice)?.[1] : undefined;
  const only = g === undefined ? undefined : groups[Number(g)];
  if (only !== undefined) tables = tables.map((t) => ({ ...t, rows: t.rows.filter((r) => r.group === only) }));
  const cols = tables.map((_, k) => {
    const c = /^c(\d+)$/.exec((res.answers[`t${k}`] as { choice: string }).choice)?.[1];
    return c === undefined ? undefined : Number(c);
  });
  const holding = tables.flatMap((t, k) => (cols[k] === undefined ? [] : [{ t, col: cols[k]! }]));
  const piece = ({ t, col }: { t: Found; col: number }, r: number): Piece => {
    const row = t.rows[r]!;
    return { text: row.cells[col] ?? "", from: row.cells[0] ?? "", lines: row.cells[col] ? boxesOf(row, col) : [] };
  };
  for (const it of items)
    for (const h of holding) {
      const r = h.t.rows.findIndex((row) => namedAs(row, it));
      if (r < 0) continue;
      out.set(it, piece(h, r));
      break;
    }
  return out;
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
 * Values read from a row's own cells where nothing else gave one: for each
 * gap, one choice among the pieces of the row's other cells, or none.
 * Keyed "row column".
 */
export async function deriveCells(client: TypeSafeClient, question: string, ours: Found, gaps: { row: number; j: number; column: string }[]): Promise<Map<string, Piece>> {
  const asks = gaps.flatMap(({ row: i, j, column }) => {
    const r = ours.rows[i]!;
    const pieces = piecesOf(r.cells.slice(1)).map((p) => ({ text: p.text, from: r.cells[p.cell + 1]!, lines: boxesOf(r, p.cell + 1) }));
    const row = rowText({ heads: ours.heads, cells: r.cells });
    return pieces.length === 0 ? [] : [{ key: `${i} ${j}`, prompt: `Which part of the row for "${r.cells[0]}" (${row}) states its ${column}?`, column, pieces }];
  });
  return choosePieces(client, question, asks);
}

/** Of several tables a passage holds, the one with a row for each of `things`. */
export async function pickTable(client: TypeSafeClient, question: string, things: string, tables: Found[]): Promise<Found> {
  const res = await timed("api", () =>
    client.systemOne({
      state: { question },
      questions: {
        table: choice(
          `Which table has a row for each of the ${things}?`,
          Object.fromEntries(
            tables.map((t, k) => [`t${k}`, `The table headed "${t.heads.join(", ")}", with rows such as ${t.rows.slice(0, 3).map((r) => `"${r.cells[0]}"`).join(", ")}`]),
          ),
        ),
      },
    }),
  );
  return tables[Number((res.answers.table as { choice: string }).choice.slice(1))] ?? tables[0]!;
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
