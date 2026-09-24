import { outline } from "../../pdf";
import { DEFAULT_MODEL, makeClient, rank, tokens } from "../../shared";
const client = await makeClient(DEFAULT_MODEL);
const K = Number(process.env.K ?? 8);
const cases: [string, string, string][] = [
  ["JEV_FALLOUT_PDF", "How is radiation treated?", "RadAway"],
  ["JEV_FALLOUT_PDF", "How many perks are there?", "Perks"],
  ["JEV_FALLOUT_PDF", "What is the cost, weight and damage rating of a combat rifle?", "Small Guns"],
  ["JEV_FALLOUT_PDF", "Is Gunslinger a perk?", "Perks"],
  ["JEV_FALLOUT_PDF", "Show me the table of all the small guns", "Small Guns"],
  ["JEV_CPR_PDF", "Show me the exotic weapons table", "Exotic Weapons"],
  ["JEV_CPR_PDF", "How much do each type of magazine cost in cyberpunk red?", "Weapon Attachments"],
  ["JEV_CPR_PDF", "Show me the table of all the standard ranged weapons", "Ranged Weapons"],
];
const sectionsOf = async (env: string) => (await outline(process.env[env]!)).map((s) => s.path);
const r = (q: string, names: string[]) => rank(client, q, [{ key: "candidates", noun: "section", items: names.map((n) => ({ label: n, value: n })) }], 40);
for (const [env, q, want] of cases) {
  const all = await sectionsOf(env);
  let t = tokens.in;
  const full = (await r(q, all)).slice(0, 12).map((x) => x.name);
  const fullTok = tokens.in - t;
  t = tokens.in;
  const full2 = (await r(q, all)).slice(0, 12).map((x) => x.name);
  // Coarse to fine: the top two levels, then what lies under the best K of them.
  t = tokens.in;
  const coarse = all.filter((p) => p.split(" > ").length <= 2);
  const topK = (await r(q, coarse)).slice(0, K).map((x) => x.name);
  const under = all.filter((p) => p.split(" > ").length > 2 && topK.some((c) => p.startsWith(c + " > ")));
  const fine = (await r(q, [...topK, ...under])).slice(0, 12).map((x) => x.name);
  const tierTok = tokens.in - t;
  const hit = (xs: string[]) => xs.slice(0, 3).some((p) => p.split(" > ").at(-1)!.includes(want));
  const ov = (xs: string[]) => xs.filter((p) => full.includes(p)).length;
  console.log(`${q.slice(0, 48).padEnd(48)} full ${fullTok.toLocaleString().padStart(7)} | rerun overlap ${ov(full2)}/12 | tiered ${tierTok.toLocaleString().padStart(7)} (${((1 - tierTok / fullTok) * 100).toFixed(0)}% less, ${coarse.length}+${topK.length + under.length} items) overlap ${ov(fine)}/12 | "${want}" in top 3: full ${hit(full)} tiered ${hit(fine)}`);
}
