/**
 * How steady jev's per-word row reading is: one request read N times, each
 * word's row probability printed per run.
 *
 *   bun experiments/across/rows.ts [N]
 */
import { makeClient, DEFAULT_MODEL, tokens } from "../../shared";
import { readAcross } from "../../shelf";

const Q = "Give me a table with Heart, Legend in the Mist and Cyberpunk Red as rows and ask how many skills are there for each row?";
const client = await makeClient(DEFAULT_MODEL);
const runs = await Promise.all(Array.from({ length: Number(Bun.argv[2] ?? 6) }, () => readAcross(client, Q)));
const words = runs[0]!.words;
for (const [i, w] of words.entries()) {
  const ps = runs.map((r) => r.row[i]!);
  if (Math.max(...ps) >= 0.1) console.log(`${w.word.padEnd(10)} row ${ps.map((p) => p.toFixed(2)).join(" ")}`);
}
for (const r of runs) console.log(`across p=${r.p.toFixed(2)} rows ${JSON.stringify(r.rows)} columns ${JSON.stringify(r.columns)}`);
console.log(`${tokens.in} tokens in`);
