/**
 * How jev reads a request for a table across the shelf, word by word, and
 * what kind it reads each cell's question as in both wordings.
 *
 *   bun experiments/across/read.ts
 */
import { readQuestion } from "../../answer";
import { readRequest } from "../../compose";
import { makeClient, DEFAULT_MODEL, tokens } from "../../shared";
import { readAcross } from "../../shelf";

const REQUESTS = [
  "Give me a table with Heart, Fallout and Cyberpunk Red as rows and ask how many skills are there for each row?",
  "Give me a table with Heart, Legend in the Mist and Cyberpunk Red as rows and ask how many skills are there for each row?",
  "Make a table with a row for Fallout and a row for Legend in the Mist, with columns how many skills are there and how does healing work",
  // Tables from one book: detection should say no.
  "Give me a table that contains each of the standard ranged weapons as a row. For each row give me single shot damage and ammo type",
  "Show me a table of the small guns with columns Damage and Barrel Mods",
];
const WATCH = new Set(["in", "the", "and", "how", "many", "are", "there", "for", "a", "row", "with"]);

const client = await makeClient(DEFAULT_MODEL);
for (const q of REQUESTS) {
  const before = tokens.in;
  const r = await readAcross(client, q);
  console.log(`\n${q}\n  across p=${r.p.toFixed(2)}  rows ${JSON.stringify(r.rows)}  columns ${JSON.stringify(r.columns)}  (${tokens.in - before} tokens)`);
  console.log(`  ${r.words.map((w, i) => (WATCH.has(w.word.toLowerCase()) || r.row[i]! >= 0.3 || r.column[i]! >= 0.3 ? `${w.word}[r${r.row[i]!.toFixed(2)} q${r.column[i]!.toFixed(2)}]` : "")).filter(Boolean).join(" ")}`);
  // What today's single-book reading makes of it, for comparison.
  const req = await readRequest(client, q);
  console.log(`  one-book reading: things ${JSON.stringify(req.things)} columns ${JSON.stringify(req.columns)}`);
  for (const row of r.rows)
    for (const col of r.columns)
      for (const cell of [`${col} in ${row}?`, `In ${row}, ${col}?`]) {
        const read = await readQuestion(client, cell);
        console.log(`    ${cell.padEnd(60)} ${read.kind.padEnd(8)} counted ${JSON.stringify(read.counted)} subject ${JSON.stringify(read.subject)} game ${JSON.stringify(read.game)}`);
      }
}
console.log(`\n${tokens.in} tokens in`);
