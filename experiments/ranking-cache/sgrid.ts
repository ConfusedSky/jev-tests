type Rq = { q: string; book: string; re: string; ranking: string[]; own: number };
const Q = ((await Bun.file(import.meta.dir + "/rankings.json").json()) as { questions: Rq[] }).questions;
const T = await Bun.file(import.meta.dir + "/texts2.json").json();
const at = (r: string[], re: RegExp) => { const i = r.findIndex((p) => re.test(p.split(" > ").at(-1)!)); return i < 0 ? 99 : i + 1; };
const good = (a: number, b: number) => at(Q[b]!.ranking, new RegExp(Q[a]!.re)) <= (Q[a]!.own === 99 ? 5 : Math.max(5, Q[a]!.own));
const pairs: [number, number][] = [];
for (let a = 0; a < Q.length; a++) for (let b = 0; b < Q.length; b++) if (a !== b && Q[a]!.book === Q[b]!.book) pairs.push([a, b]);
const cos = (x: number[], y: number[]) => { let d = 0, nx = 0, ny = 0; for (let i = 0; i < x.length; i++) { d += x[i]! * y[i]!; nx += x[i]! ** 2; ny += y[i]! ** 2; } return d / Math.sqrt(nx * ny); };
for (const [f, ts] of [["ollama_qwen3-embedding-4b", [0.7, 0.75, 0.78, 0.8, 0.85, 0.95]], ["local_Qwen3-Embedding-0.6B", [0.75, 0.8, 0.83, 0.85, 0.9, 0.95]], ["or_text-embedding-3-small", [0.55, 0.6, 0.65, 0.69, 0.75, 0.95]]] as const) {
  const e = await Bun.file(`${import.meta.dir}/embs2/${f}.json`).json();
  const sim = (a: number, b: number) => cos(e.s[a], e.s[b]);
  console.log(f, "s~s");
  for (const t of ts) { const j = pairs.filter(([a, b]) => sim(a, b) >= t), tp = j.filter(([a, b]) => good(a, b)).length; console.log(`  t=${t}: judged ${j.length}, good ${tp}, R ${Math.round(tp / 61 * 100)}%`); }
  if (f.startsWith("ollama")) for (const [a, b] of pairs.filter(([a, b]) => sim(a, b) >= 0.78)) console.log(`   ${sim(a, b).toFixed(3)} ${good(a, b) ? "good" : "BAD "} "${T.s[a]}" <- "${T.s[b]}"`);
}
// Identical subject strings: how many pairs, how many good?
const same = pairs.filter(([a, b]) => T.s[a].toLowerCase() === T.s[b].toLowerCase());
console.log("identical subject pairs", same.length, "good", same.filter(([a, b]) => good(a, b)).length);
