// Ranks each bench case's whole outline (plus excerpts) by score and by choice, flat and coarse to fine.
import { answerLayer, readDefaults } from "../../cli";
import { makeUi, outline, rankPool, textFile, type Section } from "../../pdf";
import { excerpts } from "../../search";
import { DEFAULT_MODEL, makeClient, tokens, type Ranked } from "../../shared";

const BOOKS = { heart: "JEV_HEART_PDF", fallout: "JEV_FALLOUT_PDF", litm: "JEV_LITM_PDF", cpr: "JEV_CPR_PDF" } as const;
type B = keyof typeof BOOKS;
const CASES: [B, string, number][] = [
  ["heart", "How many classes are there in heart?", 31],
  ["heart", "How many callings are there in heart?", 21],
  ["heart", "how many skills are there in heart?", 12],
  ["heart", "how many domains are there in heart?", 12],
  ["heart", "What are the skills available to a character?", 12],
  ["heart", "what are the equipment tags", 102],
  ["fallout", "How many perks are there?", 61],
  ["fallout", "How many skills are there?", 46],
  ["fallout", "How many origins are there?", 53],
  ["fallout", "How is radiation treated?", 171],
  ["fallout", "What is the cost, weight and damage rating of a combat rifle?", 97],
  ["fallout", "What is the cost, weight and damage rating of a hunting rifle?", 97],
  ["fallout", "What is the damage of every small gun?", 97],
  ["litm", "How many theme types are there?", 75],
  ["litm", "How many theme kits are there?", 76],
  ["litm", "How many tropes are there?", 78],
  ["litm", "How does hero creation work in Legend in the Mist?", 73],
  ["cpr", "How many skills are there in the game?", 132],
  ["cpr", "How much do each type of magazine cost in cyberpunk red?", 344],
];
const only = Bun.argv.slice(2);
const client = await makeClient(DEFAULT_MODEL);

// Every choice answer's spread, to see how much of the list gets any mass.
const spreads: string[] = [];
const one = client.systemOne.bind(client);
client.systemOne = (async (...args: Parameters<typeof one>) => {
  const res = await one(...args);
  for (const a of Object.values(res.answers) as { type: string; probabilities?: Record<string, number> }[]) {
    if (a.type !== "choice" || !a.probabilities) continue;
    const ps = Object.entries(a.probabilities);
    const nz = ps.filter(([, p]) => p > 0).sort((x, y) => y[1] - x[1]);
    spreads.push(`${ps.length} opts, ${nz.length} nonzero, none=${(a.probabilities["none of these"] ?? 0).toFixed(2)}, top ${nz.slice(0, 3).map(([, p]) => p.toFixed(2)).join("/")}`);
  }
  return res;
}) as typeof client.systemOne;

const ui = makeUi(true);
for (const [book, question, page] of CASES) {
  if (only.length && !only.some((o) => question.toLowerCase().includes(o.toLowerCase()) || book === o)) continue;
  const pdf = process.env[BOOKS[book]]!;
  const o = await answerLayer(client, { ...readDefaults(), search: true, question, quiet: true }, ui);
  const pool = await outline(pdf);
  const file = await textFile(pdf);
  const ex = o.terms && !o.countAcross ? ((await excerpts([file], o.terms)).get(file) ?? []) : [];
  const covers = (s: Section) => page >= s.start && page <= s.end;
  const narrow = pool.filter(covers).sort((a, b) => a.end - a.start - (b.end - b.start) || b.path.split(" > ").length - a.path.split(" > ").length)[0]!;
  const byPath = new Map(pool.map((s) => [s.path, s]));
  const measure = (all: Ranked[]) => {
    const secs = all.filter((r) => r.list === "candidates");
    const nr = secs.findIndex((r) => r.name === narrow.path) + 1;
    // First item the walk would read that lands on the page: a section spanning it (up to 12 pages) or its excerpt.
    let si = 0;
    let firstHit = 0;
    for (let i = 0; i < all.length; i++) {
      const r = all[i]!;
      if (r.list === "candidates") si++;
      const s = byPath.get(r.name);
      const hit = r.list === "excerpts" ? ex[r.index]!.page === page : s && covers(s) && s.end - s.start < 12;
      if (hit) {
        firstHit = r.list === "candidates" ? si : -si - 1;
        break;
      }
    }
    return { nr, firstHit, top: secs.slice(0, 12).map((r) => r.name), picked: all.filter((r) => r.score > 0).length };
  };
  const runs: Record<string, { tok: number; m: ReturnType<typeof measure>; s0: number }> = {};
  const tiered = pool.length > 200;
  for (const [name, byChoice, confined] of [
    ["score-flat", false, true],
    ...(tiered ? [["score-tier", false, false]] : []),
    ["choice-flat", true, true],
    ...(tiered ? [["choice-tier", true, false]] : []),
  ] as [string, boolean, boolean][]) {
    const t = tokens.in;
    const s0 = spreads.length;
    const all = await rankPool(client, { question, batch: 40, max: 12 }, pool, ex, confined, byChoice);
    runs[name] = { tok: tokens.in - t, m: measure(all), s0 };
    if (byChoice) console.log(`  ${name} rounds: ${spreads.slice(s0).join(" | ")}`);
  }
  const base = runs["score-flat"]!.m.top;
  const ref = runs[tiered ? "score-tier" : "score-flat"]!.m.top;
  console.log(`${book}: ${question} (p.${page}, narrowest "${narrow.path}", ${pool.length} sections, ${ex.length} excerpts)`);
  for (const [name, r] of Object.entries(runs)) {
    const ov = r.m.top.filter((n) => ref.includes(n)).length;
    const ovf = r.m.top.filter((n) => base.includes(n)).length;
    console.log(`  ${name.padEnd(12)} ${String(r.tok).padStart(7)} tok  narrowest #${r.m.nr || "-"}  first-on-page ${r.m.firstHit > 0 ? `section #${r.m.firstHit}` : r.m.firstHit < 0 ? `excerpt (after ${-r.m.firstHit - 1} sections)` : "none"}  top12∩ref ${ov}  top12∩flat ${ovf}  picked ${r.m.picked}`);
  }
  console.log(`  top12 score: ${ref.slice(0, 5).join(" | ")}`);
  console.log(`  top12 choice: ${runs[tiered ? "choice-tier" : "choice-flat"]!.m.top.slice(0, 5).join(" | ")}`);
}
console.log(`total ${tokens.in} tokens`);
