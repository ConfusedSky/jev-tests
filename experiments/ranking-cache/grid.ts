// Round-threshold table and the wrong matches for chosen methods.
type Rq = { q: string; book: string; re: string; ranking: string[]; own: number };
const Q = ((await Bun.file(import.meta.dir + "/rankings.json").json()) as { questions: Rq[] }).questions;
const at = (r: string[], re: RegExp) => { const i = r.findIndex((p) => re.test(p.split(" > ").at(-1)!)); return i < 0 ? 99 : i + 1; };
const good = (a: number, b: number) => at(Q[b]!.ranking, new RegExp(Q[a]!.re)) <= (Q[a]!.own === 99 ? 5 : Math.max(5, Q[a]!.own));
const pairs: [number, number][] = [];
for (let a = 0; a < Q.length; a++) for (let b = 0; b < Q.length; b++) if (a !== b && Q[a]!.book === Q[b]!.book) pairs.push([a, b]);
const G = pairs.filter(([a, b]) => good(a, b)).length;
const cos = (x: number[], y: number[]) => { let d = 0, nx = 0, ny = 0; for (let i = 0; i < x.length; i++) { d += x[i]! * y[i]!; nx += x[i]! ** 2; ny += y[i]! ** 2; } return d / Math.sqrt(nx * ny); };
const specs: [string, string, string, number[]][] = [
  ["or_text-embedding-3-small", "q", "rich", [0.45, 0.48, 0.5, 0.52, 0.55, 0.58]],
  ["or_text-embedding-3-large", "q", "rich", [0.42, 0.45, 0.48, 0.5, 0.52, 0.55]],
  ["local_Qwen3-Embedding-4B", "qi", "rich", [0.42, 0.45, 0.47, 0.49, 0.5, 0.52]],
  ["local_Qwen3-Embedding-0.6B", "qi", "rich", [0.45, 0.5, 0.53, 0.55, 0.58, 0.6]],
  ["local_Qwen3-Embedding-0.6B", "qi", "q", [0.5, 0.55, 0.58, 0.6, 0.62]],
];
const jp = (await Bun.file(import.meta.dir + "/jevpairs.json").json()).p;
const runs: [string, (a: number, b: number) => number, number[]][] = [["jev noul", (a, b) => jp[`${a},${b}`], [0.4, 0.5, 0.55, 0.6, 0.65]]];
for (const [f, x, y, ts] of specs) { const e = await Bun.file(`${import.meta.dir}/embs/${f}.json`).json(); runs.push([`${f} ${x}~${y}`, (a, b) => cos(e[x][a], e[y][b]), ts]); }
for (const [name, sim, ts] of runs) {
  console.log(`\n${name}  (good pairs: ${G})`);
  for (const t of ts) {
    const j = pairs.filter(([a, b]) => sim(a, b) >= t), tp = j.filter(([a, b]) => good(a, b)).length;
    console.log(`  t=${t}: judged ${j.length}, good ${tp}, P ${j.length ? Math.round((tp / j.length) * 100) : "-"}%, R ${Math.round((tp / G) * 100)}%`);
  }
  const t = ts[Math.floor(ts.length / 2)]!;
  for (const [a, b] of pairs.filter(([a, b]) => sim(a, b) >= t && !good(a, b))) console.log(`    wrong @${t}: ${sim(a, b).toFixed(3)} "${Q[a]!.q}" <- "${Q[b]!.q}"`);
}
