/**
 * Picking the sections jev ranks by embedding: does the answering section
 * survive, and how many sections are left for jev to score?
 *   V2(K): the best K top-two-level sections that are depth 2 (or chapters without children), and everything under them
 *   pages(N): every section holding one of the N best pages
 */
import { sectionsUnder, type Section } from "../../pdf";
import { Q } from "../ranking-cache/questions";
import { PAGE_PREFIX, embed, index, narrowest, norm, pageScores, sorted, type Book } from "./lib";

type C = { book: Book; q: string; ok: (s: Section, all: Section[]) => boolean };
const at = (pages: number[]) => (s: Section, all: Section[]) => pages.some((p) => narrowest(all, p) === s);
const cases: C[] = [
  { book: "fallout", q: "How many perks are there?", ok: at([61]) },
  { book: "fallout", q: "How many skills are there?", ok: at([46]) },
  { book: "fallout", q: "Is Gunslinger a perk?", ok: at([67]) },
  { book: "fallout", q: "How is radiation treated?", ok: at([171]) },
  { book: "fallout", q: "What is the cost, weight and damage rating of a combat rifle?", ok: at([97]) },
  { book: "fallout", q: "What is the damage of every small gun?", ok: at([97]) },
  { book: "cpr", q: "How many skills are there in the game?", ok: at([132]) },
  { book: "cpr", q: "Show me the exotic weapons table", ok: at([96, 348]) },
  { book: "cpr", q: "How much do each type of magazine cost in cyberpunk red?", ok: at([344]) },
  { book: "cpr", q: "What is the damage of all the standard ranged weapons?", ok: at([95, 342]) },
  ...Q.map(([q, b, re]): C => ({ book: b === "F" ? "fallout" : "cpr", q, ok: (s) => re.test(s.path.split(" > ").at(-1)!) })),
];
const depth = (s: Section) => s.path.split(" > ").length;
const variants: Record<string, (x: Section[], P: Map<number, number>) => Section[]> = {};
const best = (s: Section, P: Map<number, number>) => Math.max(...Array.from({ length: s.end - s.start + 1 }, (_, i) => P.get(s.start + i) ?? -2));
for (const K of [4, 8]) {
  variants[`V2(${K})`] = (x, P) => {
    const coarse = x.filter((s) => depth(s) === 2 || (depth(s) === 1 && !x.some((c) => c.path.startsWith(`${s.path} > `))));
    const top = coarse.map((s) => ({ s, v: best(s, P) })).sort((a, b) => b.v - a.v).slice(0, K).map(({ s }) => s);
    return [...top, ...sectionsUnder(x, top.map((s) => s.path))];
  };
}
for (const N of [5, 10, 20]) {
  variants[`pages(${N})`] = (x, P) => {
    const pages = sorted(P).slice(0, N).map(([p]) => p);
    return x.filter((s) => pages.some((p) => p >= s.start && p <= s.end));
  };
}
const tot: Record<string, { hit: number; items: number }> = {};
const qs = (await embed(cases.map((c) => PAGE_PREFIX + c.q))).map(norm);
for (const [i, c] of cases.entries()) {
  const x = await index(c.book, ["secpage", "page"]);
  const P = pageScores(process.env.RAW ? x.pageChunks : x.secPageChunks, qs[i]!);
  const line = [`${c.book.slice(0, 3)} ${c.q}`.slice(0, 50).padEnd(50)];
  for (const [name, f] of Object.entries(variants)) {
    const picked = f(x.sections, P);
    const hit = picked.some((s) => c.ok(s, x.sections));
    const t = (tot[name] ??= { hit: 0, items: 0 });
    t.hit += hit ? 1 : 0;
    t.items += picked.length;
    line.push(`${hit ? "y" : "N"}${String(picked.length).padStart(4)}`.padStart(10));
  }
  console.log(line.join(""));
}
console.log("".padEnd(50) + Object.keys(variants).map((k) => k.padStart(10)).join(""));
console.log("answer kept".padEnd(50) + Object.values(tot).map((t) => `${t.hit}/${cases.length}`.padStart(10)).join(""));
console.log("mean sections".padEnd(50) + Object.values(tot).map((t) => (t.items / cases.length).toFixed(0).padStart(10)).join(""));
