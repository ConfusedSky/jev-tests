/**
 * Coarse-to-fine with the coarse step done by embeddings: how many items the
 * fine jev ranking would score, against what today's ranking scored.
 *   bun experiments/embed/c2f.ts logs/gate-base1.jsonl logs/gate-q42.jsonl
 */
import { coarse, sectionsUnder, type Section } from "../../pdf";
import { BOOKS, PAGE_PREFIX, embed, index, norm, pageScores, type Book } from "./lib";

const recs = (await Promise.all(process.argv.slice(2).map((f) => Bun.file(f).text()))).join("\n").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const ranks = recs.filter((r) => r.ev === "rank" && r.tokens > 0);
const bookOf = (pdf: string) => (Object.keys(BOOKS) as Book[]).find((b) => process.env[BOOKS[b]] === pdf)!;
const K = Number(process.env.K ?? 8);
let today = 0;
let est = 0;
for (const r of ranks) {
  const b = bookOf(r.pdf);
  if (b !== "fallout" && b !== "cpr") continue;
  const x = await index(b, ["secpage"]);
  if (x.sections.length <= 200 || r.n < x.sections.length) continue; // confined or short: not tiered
  const ex = r.n - x.sections.length;
  const [q] = (await embed([PAGE_PREFIX + r.q])).map(norm);
  const P = pageScores(x.secPageChunks, q!);
  const best = (s: Section) => Math.max(...Array.from({ length: s.end - s.start + 1 }, (_, i) => P.get(s.start + i) ?? -2));
  const top = coarse(x.sections).map((s) => ({ s, v: best(s) })).sort((a, b) => b.v - a.v).slice(0, K).map(({ s }) => s);
  const under = sectionsUnder(x.sections, top.map((s) => s.path));
  const items = top.length + under.length + ex;
  const perItem = 122;
  today += r.tokens;
  est += items * perItem;
  console.log(`${b.padEnd(7)} today ${String(r.tokens).padStart(6)}  emb-c2f ~${String(items * perItem).padStart(6)} (${top.length}+${under.length} sections, ${ex} excerpts)  ${r.q.slice(0, 60)}`);
}
console.log(`total today ${today}, embedding coarse step ~${est} (${Math.round((100 * (today - est)) / today)}% less)`);
