// Real walks for the labelled pairs near and above the OR rule: each question walked on a ranking made afresh, then
// on each partner's cached ranking (the one the fresh walk stored, excerpts and all) whatever its score, to see
// whether a walk off a cached ranking misses where ranking afresh answers, by distance above the rule. Spends tokens.
//   bun experiments/ranking-cache/walks.ts            list the pairs and what is already walked
//   bun experiments/ranking-cache/walks.ts run 0.12   walk what is missing, stopping before $0.12
// Readings come from subjects.json, so nothing is spent reading and the subjects are the labelled ones.
// Results go to walks.json; a rerun walks only what is missing. The rankings the fresh walks keep sit under
// /tmp/jev-walks, so a rerun after they are gone needs walks.json cleared too.
import { mkdir } from "node:fs/promises";
import { CACHE_MODELS, embedder, rankingCache, type RankingCache } from "../../cache";
import { answerLayer, readDefaults } from "../../cli";
import type { Reading } from "../../answer";
import { makeUi, searchPdf } from "../../pdf";
import { DEFAULT_MODEL, DOLLARS_PER_MILLION_IN, makeClient, tokens } from "../../shared";

type Rq = { q: string; book: string; re: string; ranking: string[]; own: number };
const Q = ((await Bun.file(import.meta.dir + "/rankings.json").json()) as { questions: Rq[] }).questions;
const R = ((await Bun.file(import.meta.dir + "/subjects.json").json()) as { readings: Reading[] }).readings;
const at = (r: string[], re: RegExp) => { const i = r.findIndex((p) => re.test(p.split(" > ").at(-1)!)); return i < 0 ? 99 : i + 1; };
const good = (a: number, b: number) => at(Q[b]!.ranking, new RegExp(Q[a]!.re)) <= (Q[a]!.own === 99 ? 5 : Math.max(5, Q[a]!.own));
const cos = (x: number[], y: number[]) => { let d = 0, nx = 0, ny = 0; for (let i = 0; i < x.length; i++) { d += x[i]! * y[i]!; nx += x[i]! ** 2; ny += y[i]! ** 2; } return d / Math.sqrt(nx * ny); };
const e = await Bun.file(import.meta.dir + "/embs2/ollama_qwen3-embedding-4b.json").json();
const m = CACHE_MODELS["qwen3-4b"]!;
const over = (A: number, B: number) => Math.max(A - m.whole, B - m.subject);
const FROM = -0.05; // pairs this far under the rule too, to see the trend below it

const pairs: { a: number; b: number; over: number; good: boolean }[] = [];
for (let a = 0; a < Q.length; a++) for (let b = 0; b < Q.length; b++)
  if (a !== b && Q[a]!.book === Q[b]!.book) {
    const d = over(cos(e.qi[a], e.rich[b]), cos(e.s[a], e.s[b]));
    if (d >= FROM) pairs.push({ a, b, over: d, good: good(a, b) });
  }
pairs.sort((x, y) => y.over - x.over);
const involved = [...new Set(pairs.flatMap((p) => [p.a, p.b]))].sort((x, y) => x - y);

type Walk = { answered: boolean; page?: number; section?: string; p?: number; right: boolean; tokens: number; lookedUp: boolean; whole?: number; subject?: number };
const file = Bun.file(import.meta.dir + "/walks.json");
const done: Record<string, Walk> = (await file.exists()) ? await file.json() : {};
const key = (a: number, b?: number) => (b === undefined ? `${a}` : `${a}<-${b}`);
const dir = (b: number) => `/tmp/jev-walks/${b}`;
const pdf = (i: number) => (Q[i]!.book === "F" ? process.env.JEV_FALLOUT_PDF : process.env.JEV_CPR_PDF)!;

if (process.argv[2] !== "run") {
  console.log(`${pairs.length} pairs at ${FROM} or more over the rule (${pairs.filter((p) => p.over >= 0).length} accepted); ${involved.length} questions`);
  console.log(`fresh walks done ${involved.filter((i) => done[key(i)]).length}/${involved.length}, cached ${pairs.filter((p) => done[key(p.a, p.b)]).length}/${pairs.length}\n`);
  // Right when the hit's section, or one it sits in, is the answer's: "Cyberpsychosis > How Cyberware Fits in" is.
  const right = (a: number, w?: Walk) => !!w?.section && w.section.split(" > ").some((s) => new RegExp(Q[a]!.re).test(s));
  const said = (a: number, w?: Walk) => (!w ? "—" : !w.answered ? "missed" : right(a, w) ? `p.${w.page}` : `wrong p.${w.page}`);
  const f3 = (x: number) => (x >= 0 ? "+" : "") + x.toFixed(3);
  type Row = { live: number; labelled: number; good: boolean; fresh: string; cached: string; tokens: [number, number]; how: string; who: string };
  const rows: Row[] = [];
  for (const p of pairs) {
    const c = done[key(p.a, p.b)], f = done[key(p.a)];
    // A walk the contents confined never looked at the cached ranking, so it says nothing about it.
    if (!c || !f || !c.lookedUp) continue;
    const same = c.answered && f.answered && c.page === f.page;
    const [fr, cr] = [right(p.a, f), right(p.a, c)];
    const how = same ? "same page" : cr === fr ? (cr ? "both right" : "neither right") : !cr ? (c.answered ? "fresh right, cached wrong" : "RESCUED: cached missed, fresh answered") : "cached right, fresh not";
    rows.push({ live: over(c.whole!, c.subject!), labelled: p.over, good: p.good, fresh: said(p.a, f), cached: said(p.a, c), tokens: [f.tokens, c.tokens], how, who: `${Q[p.a]!.q} <- ${Q[p.b]!.q}` });
  }
  rows.sort((x, y) => y.live - x.live);
  console.log("live over | labelled over, pair | fresh walk | cached walk | tokens fresh/cached | outcome");
  for (const r of rows) console.log(`  ${f3(r.live)} | ${f3(r.labelled)} ${r.good ? "good" : "bad "} | ${r.fresh.padEnd(10)} | ${r.cached.padEnd(10)} | ${String(r.tokens[0]).padStart(6)}/${String(r.tokens[1]).padStart(6)} | ${r.how}  ${r.who}`);
  console.log("\nby the live distance over the rule (what the UI would see):");
  for (const [lo, hi] of [[-9, -0.05], [-0.05, 0], [0, 0.03], [0.03, 0.05], [0.05, 0.1], [0.1, 9]]) {
    const b = rows.filter((r) => r.live >= lo && r.live < hi);
    const n = (s: string) => b.filter((r) => r.how.startsWith(s)).length;
    console.log(`  ${lo === -9 ? "   below" : f3(lo)}..${hi === 9 ? "      " : f3(hi)}  ${String(b.length).padStart(2)} walked: same page ${n("same")}, both right ${n("both")}, rescued ${n("RESCUED")}, fresh right & cached wrong ${n("fresh right")}, cached right & fresh not ${n("cached right")}, neither ${n("neither")}`);
  }
  process.exit(0);
}
const cap = Number(process.argv[3] ?? 0.1);
const client = await makeClient(DEFAULT_MODEL);
const ui = makeUi(true);
const embed = embedder(m);
const spent = () => (tokens.in / 1e6) * DOLLARS_PER_MILLION_IN;

async function walk(a: number, cache: RankingCache, note: Partial<Walk>): Promise<Walk> {
  const before = tokens.in;
  // A table asked for by name is read as a passage, as the bench's case is.
  const reading = { ...R[a]!, kind: R[a]!.kind === "table" ? "passage" : R[a]!.kind } as Reading;
  const o = await answerLayer(client, { ...readDefaults(), question: Q[a]!.q, quiet: true, cache: "off" }, ui, reading);
  let lookedUp = false;
  const r = await searchPdf(client, pdf(a), { ...o, rankingCache: { lookup: (p) => ((lookedUp = true), cache.lookup(p)), store: cache.store } }, ui);
  const h = r.hit;
  const right = !!h && new RegExp(Q[a]!.re).test(h.section.split(" > ").at(-1)!);
  return { answered: !!h, page: h?.page, section: h?.section, p: h?.answer?.p, right, tokens: tokens.in - before, lookedUp, ...note };
}
const save = () => Bun.write(file, JSON.stringify(done, null, 1));

async function fresh(a: number) {
  if (done[key(a)]) return;
  await mkdir(dir(a), { recursive: true });
  // An empty cache of its own: the lookup misses, the book is ranked afresh, and the ranking is kept if it answered.
  done[key(a)] = await walk(a, rankingCache(m, embed, dir(a), Q[a]!.q, R[a]!.subject), {});
  console.log(`fresh ${key(a)} ${JSON.stringify(done[key(a)])} $${spent().toFixed(4)}`);
  await save();
}
// The weakest accepted pairs first, then those just under the rule, so a spent cap cuts the least telling ones.
const order = [...pairs.filter((p) => p.over >= 0).sort((x, y) => x.over - y.over), ...pairs.filter((p) => p.over < 0)];
for (const p of order) {
  const k = key(p.a, p.b);
  if (done[k]) continue;
  if (spent() > cap) break;
  await fresh(p.b);
  await fresh(p.a);
  if (!done[key(p.b)]!.answered || spent() > cap) continue;
  // No bar: the partner's ranking is walked whatever the pair scores, and the score is recorded beside it.
  const forced = rankingCache({ ...m, whole: -2, subject: 2 }, embed, dir(p.b), Q[p.a]!.q, R[p.a]!.subject);
  const f = await forced.lookup(pdf(p.a));
  // A ranking the contents confined was never kept, so no cache would hold it.
  if (!f) {
    console.log(`no cached ranking for ${k}`);
    continue;
  }
  done[k] = await walk(p.a, { lookup: async () => f, store: async () => {} }, { whole: f?.whole, subject: f?.subject });
  console.log(`cached ${k} ${JSON.stringify(done[k])} $${spent().toFixed(4)}`);
  await save();
}
console.log(`spent $${spent().toFixed(4)} this run`);
