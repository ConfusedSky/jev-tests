/**
 * Part A: rank pages by embedding and compare with jev's ranking.
 *   bun experiments/embed/evalA.ts [gate-log.jsonl]
 * The gate log (from a bench run with JEV_GATE_LOG) supplies jev's top-20
 * for the bench questions; rankings.json supplies it for the 42 questions.
 */
import type { Section } from "../../pdf";
import { Q } from "../ranking-cache/questions";
import { PAGE_PREFIX, SEC_PREFIX, dot, embed, index, norm, pageScores, sorted, vec, type Book, type Index } from "./lib";

type Case = { book: Book; q: string; pages?: number[]; re?: RegExp; jevTop?: string[]; jevOwn?: number };

const BENCH: Case[] = [
  { book: "heart", q: "How many classes are there in heart?", pages: [31] },
  { book: "heart", q: "How many callings are there in heart?", pages: [21] },
  { book: "heart", q: "how many skills are there in heart?", pages: [12] },
  { book: "heart", q: "how many domains are there in heart?", pages: [12] },
  { book: "heart", q: "What are the skills available to a character?", pages: [12] },
  { book: "heart", q: "what are the equipment tags", pages: [102] },
  { book: "fallout", q: "How many perks are there?", pages: [61] },
  { book: "fallout", q: "How many skills are there?", pages: [46] },
  { book: "fallout", q: "How many origins are there?", pages: [53] },
  { book: "fallout", q: "Is Gunslinger a perk?", pages: [67] },
  { book: "fallout", q: "How is radiation treated?", pages: [171] },
  { book: "fallout", q: "What is the cost, weight and damage rating of a combat rifle?", pages: [97] },
  { book: "fallout", q: "What is the cost, weight and damage rating of a hunting rifle?", pages: [97] },
  { book: "fallout", q: "What is the cost and weight of every small gun?", pages: [97] },
  { book: "fallout", q: "What is the damage of every small gun?", pages: [97] },
  { book: "litm", q: "How many theme types are there?", pages: [75] },
  { book: "litm", q: "How many theme kits are there?", pages: [76] },
  { book: "litm", q: "How many tropes are there?", pages: [78] },
  { book: "litm", q: "How does hero creation work in Legend in the Mist?", pages: [73] },
  { book: "cpr", q: "How many skills are there in the game?", pages: [132] },
  { book: "cpr", q: "Show me the exotic weapons table", pages: [96, 348] },
  { book: "cpr", q: "How much do each type of magazine cost in cyberpunk red?", pages: [344] },
  { book: "cpr", q: "What is the damage of all the standard ranged weapons?", pages: [95, 342] },
];

const ix = new Map<Book, Index>();
const get = async (b: Book) => ix.get(b) ?? (ix.set(b, await index(b)), ix.get(b)!);

/** Pages of the sections whose last path component matches. */
const pagesOf = (sections: Section[], re: RegExp) =>
  [...new Set(sections.filter((s) => re.test(s.path.split(" > ").at(-1)!)).flatMap((s) => Array.from({ length: s.end - s.start + 1 }, (_, i) => s.start + i)))];

/** jev's section order expanded to pages in walk order (excerpts "p.N" as one page). */
function expand(top: string[], sections: Section[]): number[] {
  const byPath = new Map(sections.map((s) => [s.path, s]));
  const out: number[] = [];
  for (const t of top) {
    const m = /^p\.(\d+)/.exec(t);
    if (m) out.push(Number(m[1]));
    else {
      const s = byPath.get(t);
      if (s) for (let p = s.start; p <= s.end; p++) out.push(p);
    }
  }
  return [...new Set(out)];
}
const rankIn = (order: number[], answer: Set<number>) => {
  const i = order.findIndex((p) => answer.has(p));
  return i < 0 ? 999 : i + 1;
};

// Bench jev rankings from the gate log.
const logFile = process.argv[2];
if (logFile) {
  const lines = (await Bun.file(logFile).text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  for (const c of BENCH) {
    const r = lines.find((l) => l.ev === "rank" && l.q === c.q && l.top?.length);
    if (r) c.jevTop = r.top;
  }
}
const rk = (await Bun.file(new URL("../ranking-cache/rankings.json", import.meta.url)).json()) as { questions: { q: string; ranking: string[]; own: number }[] };
const MAIN: Case[] = Q.map(([q, b, re]) => {
  const r = rk.questions.find((x) => x.q === q)!;
  return { book: b === "F" ? "fallout" : "cpr", q, re, jevTop: r.ranking, jevOwn: r.own };
});

type Row = Record<string, number>;
const variants = ["P", "SP", "T", "T+P", "maxSP"] as const;

async function score(c: Case, qPage: number[], qSec: number[]): Promise<Row> {
  const x = await get(c.book);
  const answer = new Set(c.pages ?? pagesOf(x.sections, c.re!));
  const P = pageScores(x.pageChunks, qPage);
  const SP = pageScores(x.secPageChunks, qPage);
  // Title cos per section; a page gets the best title of any section it lies in.
  const T = new Map<number, number>();
  x.sections.forEach((s, i) => {
    const t = dot(qSec, vec(x.titles, i));
    for (let p = s.start; p <= s.end; p++) if (t > (T.get(p) ?? -2)) T.set(p, t);
  });
  const TP = new Map([...P].map(([p, v]) => [p, v + 0.5 * (T.get(p) ?? 0)]));
  const mx = new Map([...P].map(([p, v]) => [p, Math.max(v, SP.get(p) ?? -2)]));
  const row: Row = {};
  const orders = { P, SP, T, "T+P": TP, maxSP: mx };
  for (const v of variants) row[v] = rankIn(sorted(orders[v]).map(([p]) => p), answer);
  if (c.jevTop) row.jevPage = rankIn(expand(c.jevTop, x.sections), answer);
  if (c.jevTop) row.jevSec = c.jevTop.findIndex((t) => { const m = /^p\.(\d+)/.exec(t); if (m) return answer.has(Number(m[1])); const s = x.sections.find((s) => s.path === t); return !!s && [...answer].some((p) => p >= s.start && p <= s.end); }) + 1 || 999;
  // Coarse-to-fine by embedding: is the answer under one of the best 8 top-two-level sections, by title and by max page?
  const coarse = x.sections.filter((s) => s.path.split(" > ").length <= 2);
  const coarseBy = (f: (s: Section) => number) => coarse.map((s) => ({ s, v: f(s) })).sort((a, b) => b.v - a.v).slice(0, 8);
  const holds = (s: Section) => [...answer].some((p) => p >= s.start && p <= s.end);
  const cT = coarseBy((s) => dot(qSec, vec(x.titles, x.sections.indexOf(s))));
  const cP = coarseBy((s) => Math.max(...Array.from({ length: s.end - s.start + 1 }, (_, i) => SP.get(s.start + i) ?? -2)));
  row.c2fT = cT.some(({ s }) => holds(s)) ? 1 : 0;
  row.c2fP = cP.some(({ s }) => holds(s)) ? 1 : 0;
  row.pages = x.pages.length;
  return row;
}

async function run(name: string, cases: Case[]) {
  const t = Date.now();
  const qp = (await embed(cases.map((c) => PAGE_PREFIX + c.q))).map(norm);
  const qs = (await embed(cases.map((c) => SEC_PREFIX + c.q))).map(norm);
  const qms = (Date.now() - t) / cases.length / 2;
  const rows: Row[] = [];
  console.log(`\n## ${name} (${cases.length} questions; query embedding ${qms.toFixed(0)} ms each, batched)`);
  console.log(["question".padEnd(46), ...variants.map((v) => v.padStart(5)), "jevPg", "jevSc", "c2fT", "c2fP"].join(" "));
  for (const [i, c] of cases.entries()) {
    const r = await score(c, qp[i]!, qs[i]!);
    rows.push(r);
    const f = (n: number | undefined) => (n === undefined ? "  -" : n >= 999 ? " miss" : String(n)).padStart(5);
    console.log([`${c.book.slice(0, 3)} ${c.q}`.slice(0, 46).padEnd(46), ...variants.map((v) => f(r[v])), f(r.jevPage), f(r.jevSec), f(r.c2fT), f(r.c2fP)].join(" "));
  }
  const keys = [...variants, "jevPage", "jevSec"] as const;
  for (const k of [1, 3, 5, 12, 30]) {
    console.log(`recall@${k}`.padEnd(46), ...keys.map((v) => { const have = rows.filter((r) => r[v] !== undefined); return `${have.filter((r) => r[v]! <= k).length}/${have.length}`.padStart(5); }));
  }
  console.log("c2f answer under best-8 coarse: by title", rows.reduce((s, r) => s + r.c2fT!, 0), "by page", rows.reduce((s, r) => s + r.c2fP!, 0), "of", rows.length);
}

await run("bench questions, exact answer page", BENCH);
await run("42 ranking-cache questions, answer = any page of a matching section", MAIN);
