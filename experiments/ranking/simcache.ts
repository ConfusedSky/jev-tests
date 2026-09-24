import { noul } from "@typesafe-ai/sdk";
import { coarse, outline, sectionsUnder } from "../../pdf";
import { DEFAULT_MODEL, makeClient, rank, tokens } from "../../shared";
const client = await makeClient(DEFAULT_MODEL);
// question, book, what the answering section's name holds
const Q: [string, string, RegExp][] = [
  ["How is radiation treated?", "F", /RadAway|Radiation/],
  ["How do I cure radiation sickness?", "F", /RadAway|Radiation/],
  ["What does RadAway do?", "F", /RadAway/],
  ["How many perks are there?", "F", /Perks/],
  ["Is Gunslinger a perk?", "F", /Perks/],
  ["Is Lockpick a perk?", "F", /Perks/],
  ["What is the cost, weight and damage rating of a combat rifle?", "F", /Small Guns|Combat Rifle/],
  ["What is the cost, weight and damage rating of a hunting rifle?", "F", /Small Guns|Hunting Rifle/],
  ["What is the damage of every small gun?", "F", /Small Guns/],
  ["How many skills are there?", "F", /Skills/],
  ["What are the skills available to a character?", "F", /Skills/],
  ["Show me the exotic weapons table", "C", /Exotic/],
  ["What do the exotic weapons cost?", "C", /Exotic/],
  ["How much do each type of magazine cost?", "C", /Attachments|Magazine/],
  ["How much does a drum magazine cost?", "C", /Attachments|Magazine/],
  ["How many skills are there in the game?", "C", /Skill/],
];
const books = { F: (await outline(process.env.JEV_FALLOUT_PDF!)).filter((s) => s.path), C: (await outline(process.env.JEV_CPR_PDF!)) };
const items = (names: string[]) => [{ key: "candidates", noun: "section", items: names.map((n) => ({ label: n, value: n })) }];
async function tiered(q: string, pool: typeof books.F) {
  const first = await rank(client, q, items(coarse(pool).map((s) => s.path)), 40);
  const under = sectionsUnder(pool, first.slice(0, 8).map((r) => r.name));
  const second = await rank(client, q, items(under.map((s) => s.path)), 40);
  return [...first, ...second].sort((a, b) => b.score - a.score || b.confidence - a.confidence).map((r) => r.name);
}
const before = tokens.in;
const rankings = await Promise.all(Q.map(([q, b]) => tiered(q, books[b as "F" | "C"])));
const rankTok = (tokens.in - before) / Q.length;
const at = (r: string[], re: RegExp) => { const i = r.findIndex((p) => re.test(p.split(" > ").at(-1)!)); return i < 0 ? 99 : i + 1; };
// Every ordered pair within a book: would the cached question's ranking serve the new one?
const pairs: { a: number; b: number }[] = [];
for (const [a] of Q.entries()) for (const [b] of Q.entries()) if (a !== b && Q[a]![1] === Q[b]![1]) pairs.push({ a, b });
const t0 = tokens.in;
const res = await client.systemOne({
  state: { question: "" },
  questions: Object.fromEntries(pairs.map(({ a, b }, k) => [`p${k}`, noul(`The same sections of a rulebook would answer "${Q[a]![0]}" as answer "${Q[b]![0]}"`)])),
});
const simTok = (tokens.in - t0) / pairs.length;
const rows = pairs.map(({ a, b }, k) => ({ a, b, p: (res.answers as any)[`p${k}`].noul as number, own: at(rankings[a]!, Q[a]![2]), cached: at(rankings[b]!, Q[a]![2]) }));
console.log(`one ranking ≈ ${Math.round(rankTok).toLocaleString()} tokens; one similarity question ≈ ${Math.round(simTok).toLocaleString()} tokens`);
console.log("own rank of each question's answering section:", Q.map(([q], i) => `${i}:${at(rankings[i]!, Q[i]![2])}`).join(" "));
for (const bar of [0.5, 0.7, 0.85]) {
  const yes = rows.filter((r) => r.p >= bar);
  const good = (r: (typeof rows)[number]) => r.cached <= Math.max(5, r.own);
  console.log(`bar ${bar}: ${yes.length}/${rows.length} pairs judged similar; of those ${yes.filter(good).length} keep the answer in the top ${"max(5, own)"}; of pairs judged not similar, ${rows.filter((r) => r.p < bar && good(r)).length} would have been fine`);
}
for (const r of rows.filter((r) => r.p >= 0.5).sort((x, y) => y.p - x.p)) console.log(`  ${r.p.toFixed(2)}  "${Q[r.a]![0].slice(0, 45)}" ← "${Q[r.b]![0].slice(0, 45)}"  answer at ${r.cached} (own ${r.own})`);
