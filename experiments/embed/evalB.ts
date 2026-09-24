/**
 * Part B: for every page the walk gated (a JEV_GATE_LOG from bench runs),
 * its embedding cosine to the question beside jev's gate value, and what
 * a low / high bar would have skipped and got wrong.
 *   bun experiments/embed/evalB.ts logs/gate-*.jsonl
 */
import { BOOKS, PAGE_PREFIX, embed, index, norm, pageScores, sorted, type Book, type Index } from "./lib";

const KNOWN: Record<string, number[]> = {
  "How many classes are there in heart?": [31],
  "How many callings are there in heart?": [21],
  "how many skills are there in heart?": [12],
  "how many domains are there in heart?": [12],
  "What are the skills available to a character?": [12],
  "what are the equipment tags": [102],
  "How many perks are there?": [61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80],
  "How many skills are there?": [46],
  "How many origins are there?": [53],
  "Is Gunslinger a perk?": [67],
  "How is radiation treated?": [171],
  "What is the cost, weight and damage rating of a combat rifle?": [97],
  "What is the cost, weight and damage rating of a hunting rifle?": [97],
  "What is the cost and weight of every small gun?": [97],
  "What is the damage of every small gun?": [97],
  "How many theme types are there?": [75],
  "How many theme kits are there?": [76, 77],
  "How many tropes are there?": [78],
  "How does hero creation work in Legend in the Mist?": [73],
  "How many skills are there in the game?": [132],
  "Show me the exotic weapons table": [96, 348],
  "How much do each type of magazine cost in cyberpunk red?": [344],
  "What is the damage of all the standard ranged weapons?": [95, 342],
};

type Rec = { ev: string; q: string; pdf: string; name: string; page: number; end?: number; p: number; len: number; tokens?: number; pages?: number[]; lens?: number[]; verdict?: string; hitPage?: number };
const recs: Rec[] = [];
for (const f of process.argv.slice(2)) recs.push(...(await Bun.file(f).text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Rec));

const bookOf = (pdf: string) => (Object.keys(BOOKS) as Book[]).find((b) => process.env[BOOKS[b]] === pdf)!;
const ix = new Map<Book, Index>();
const get = async (b: Book) => ix.get(b) ?? (ix.set(b, await index(b, ["page"])), ix.get(b)!);

// Answer pages: the known ones, and every page a verify took.
const answers = new Map<string, Set<number>>();
for (const r of recs) {
  const s = answers.get(r.q) ?? new Set(KNOWN[r.q] ?? []);
  if (r.ev === "settle" && r.verdict === "take") s.add(r.hitPage!), s.add(r.page);
  answers.set(r.q, s);
}
const qs = [...new Set(recs.map((r) => r.q))];
const qv = new Map(qs.map((q, i) => [q, i]));
const qvecs = (await embed(qs.map((q) => PAGE_PREFIX + q))).map(norm);

// Tokens per gated page: its share of its call by length.
const pageTok = new Map<string, number>();
for (const r of recs.filter((r) => r.ev === "call")) {
  const sum = r.lens!.reduce((a, b) => a + b, 0);
  r.pages!.forEach((p, i) => pageTok.set(`${r.q}|${r.pdf}|${p}`, (r.tokens! * r.lens![i]!) / sum));
}

type Row = { q: string; book: Book; page: number; cos: number; rank: number; rel: number; p: number; answer: boolean; tok: number };
const rows: Row[] = [];
for (const r of recs.filter((r) => r.ev === "gate")) {
  const b = bookOf(r.pdf);
  const x = await get(b);
  const P = pageScores(x.pageChunks, qvecs[qv.get(r.q)!]!);
  const order = sorted(P);
  const best = order[0]![1];
  const cos = P.get(r.page) ?? -1;
  rows.push({ q: r.q, book: b, page: r.page, cos, rank: order.findIndex(([p]) => p === r.page) + 1, rel: cos - best, p: r.p, answer: answers.get(r.q)!.has(r.page), tok: pageTok.get(`${r.q}|${r.pdf}|${r.page}`) ?? 0 });
}

const T = 0.7;
const yes = rows.filter((r) => r.p >= T);
const totalTok = rows.reduce((s, r) => s + r.tok, 0);
console.log(`${rows.length} gated pages over ${qs.length} questions; ${yes.length} jev yes (p>=${T}); ${rows.filter((r) => r.answer).length} answer pages; ~${Math.round(totalTok).toLocaleString()} gate tokens`);
const f = (n: number) => n.toFixed(3);
const stats = (xs: number[]) => (xs.length ? `min ${f(Math.min(...xs))} max ${f(Math.max(...xs))}` : "-");
console.log("cos of jev-yes pages:", stats(yes.map((r) => r.cos)), "| jev-no:", stats(rows.filter((r) => r.p < T).map((r) => r.cos)), "| answer pages:", stats(rows.filter((r) => r.answer).map((r) => r.cos)));
console.log("\nlowest-cos jev-yes / answer pages:");
for (const r of rows.filter((r) => r.p >= T || r.answer).sort((a, b) => a.cos - b.cos).slice(0, 12))
  console.log(`  cos ${f(r.cos)} rank ${String(r.rank).padStart(3)} rel ${f(r.rel)} p ${r.p.toFixed(2)} ${r.answer ? "ANS" : "   "} ${r.book} p.${r.page}  ${r.q.slice(0, 60)}`);
console.log("\nhighest-cos jev-no pages:");
for (const r of rows.filter((r) => r.p < T).sort((a, b) => b.cos - a.cos).slice(0, 12))
  console.log(`  cos ${f(r.cos)} rank ${String(r.rank).padStart(3)} p ${r.p.toFixed(2)} ${r.answer ? "ANS" : "   "} ${r.book} p.${r.page}  ${r.q.slice(0, 60)}`);

const sweep = (name: string, key: (r: Row) => number, lows: number[], highs: number[]) => {
  console.log(`\n${name}: LOW bar (drop below)   dropped  tokens  jev-yes lost  answers lost`);
  for (const L of lows) {
    const d = rows.filter((r) => key(r) < L);
    console.log(`  ${String(L).padStart(6)}  ${String(d.length).padStart(5)}/${rows.length}  ${String(Math.round(d.reduce((s, r) => s + r.tok, 0))).padStart(7)} (${Math.round((100 * d.reduce((s, r) => s + r.tok, 0)) / totalTok)}%)  ${d.filter((r) => r.p >= T).length}  ${d.filter((r) => r.answer).length}`);
  }
  console.log(`${name}: HIGH bar (keep at/above)  kept  jev-no kept  answers  tokens`);
  for (const H of highs) {
    const k = rows.filter((r) => key(r) >= H);
    console.log(`  ${String(H).padStart(6)}  ${String(k.length).padStart(5)}  ${k.filter((r) => r.p < T).length}  ${k.filter((r) => r.answer).length}  ${Math.round(k.reduce((s, r) => s + r.tok, 0))}`);
  }
};
sweep("absolute cos", (r) => r.cos, [0.2, 0.25, 0.3, 0.32, 0.35, 0.38, 0.4, 0.42, 0.45], [0.5, 0.55, 0.6, 0.65, 0.7]);
sweep("cos - book's best cos", (r) => r.rel, [-0.3, -0.25, -0.2, -0.15, -0.12, -0.1, -0.08], [-0.02, -0.01, 0]);
sweep("-rank in book", (r) => -r.rank, [-400, -200, -100, -60, -40, -30, -20, -10], [-1, -2, -3]);
if (process.env.DUMP) await Bun.write(process.env.DUMP, JSON.stringify(rows));
