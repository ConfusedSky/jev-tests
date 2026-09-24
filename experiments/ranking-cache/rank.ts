import { coarse, outline, sectionsUnder } from "../../pdf";
import { DEFAULT_MODEL, makeClient, rank, tokens } from "../../shared";
import { Q, at } from "./questions";
const client = await makeClient(DEFAULT_MODEL);
const books = { F: (await outline(process.env.JEV_FALLOUT_PDF!)).filter((s) => s.path), C: await outline(process.env.JEV_CPR_PDF!) };
const items = (names: string[]) => [{ key: "candidates", noun: "section", items: names.map((n) => ({ label: n, value: n })) }];
async function tiered(q: string, pool: typeof books.F) {
  const first = await rank(client, q, items(coarse(pool).map((s) => s.path)), 40);
  const under = sectionsUnder(pool, first.slice(0, 8).map((r) => r.name));
  const second = await rank(client, q, items(under.map((s) => s.path)), 40);
  return [...first, ...second].sort((a, b) => b.score - a.score || b.confidence - a.confidence).map((r) => r.name);
}
const out: { q: string; book: string; re: string; ranking: string[]; own: number; ms: number }[] = new Array(Q.length);
let next = 0;
const t0 = Date.now();
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < Q.length) {
    const i = next++;
    const [q, b, re] = Q[i]!;
    const s = Date.now();
    const ranking = await tiered(q, books[b]);
    out[i] = { q, book: b, re: re.source, ranking, own: at(ranking, re), ms: Date.now() - s };
    console.log(i, out[i].own, out[i].ms, q, "|", ranking.slice(0, 3).join(" ; "));
  }
}));
await Bun.write(import.meta.dir + "/rankings.json", JSON.stringify({ tokensPerRanking: tokens.in / Q.length, dollars: tokens.in * 0.042 / 1e6, wallMs: Date.now() - t0, questions: out }, null, 1));
console.log("tokens/ranking", Math.round(tokens.in / Q.length), "total $", (tokens.in * 0.042 / 1e6).toFixed(4));
