// Scores every similarity method on the same rankings: ordered same-book pairs (a new, b cached).
import { Glob } from "bun";
type Rq = { q: string; book: string; re: string; ranking: string[]; own: number };
const R = (await Bun.file(import.meta.dir + "/rankings.json").json()) as { questions: Rq[] };
const Q = R.questions;
const at = (r: string[], re: RegExp) => { const i = r.findIndex((p) => re.test(p.split(" > ").at(-1)!)); return i < 0 ? 99 : i + 1; };
// A question whose own ranking missed its answer can only be served by a cached ranking with it in the top 5.
const good = (a: number, b: number) => at(Q[b]!.ranking, new RegExp(Q[a]!.re)) <= (Q[a]!.own === 99 ? 5 : Math.max(5, Q[a]!.own));
const pairs: [number, number][] = [];
for (let a = 0; a < Q.length; a++) for (let b = 0; b < Q.length; b++) if (a !== b && Q[a]!.book === Q[b]!.book) pairs.push([a, b]);
const G = pairs.filter(([a, b]) => good(a, b)).length;
const cos = (x: number[], y: number[]) => { let d = 0, nx = 0, ny = 0; for (let i = 0; i < x.length; i++) { d += x[i]! * y[i]!; nx += x[i]! ** 2; ny += y[i]! ** 2; } return d / Math.sqrt(nx * ny); };
type Method = { name: string; sim: (a: number, b: number) => number };
const methods: Method[] = [];
const jp = (await Bun.file(import.meta.dir + "/jevpairs.json").json()).p as Record<string, number>;
methods.push({ name: "jev noul pairwise", sim: (a, b) => jp[`${a},${b}`]! });
for (const f of [...new Glob("embs/*.json").scanSync(import.meta.dir)].sort()) {
  const e = await Bun.file(`${import.meta.dir}/${f}`).json();
  const id = f.slice(5, -5);
  const variants: [string, string, string][] = [["q~q", "q", "q"], ["q~rich", "q", "rich"]];
  if (e.qi && /qwen/i.test(id)) variants.push(["qi~q", "qi", "q"], ["qi~rich", "qi", "rich"]);
  for (const [v, x, y] of variants) {
    const M: number[][] = Q.map((_, a) => Q.map((_, b) => cos(e[x][a], e[y][b])));
    methods.push({ name: `${id} ${v}`, sim: (a, b) => M[a]![b]! });
  }
}
function sweep(m: Method, ps: [number, number][]) {
  const s = ps.map(([a, b]) => ({ v: m.sim(a, b), g: good(a, b) })).sort((x, y) => y.v - x.v);
  const g = s.filter((x) => x.g).length;
  let tp = 0; const pts: { t: number; n: number; tp: number }[] = [];
  s.forEach((x, i) => { if (x.g) tp++; if (i === s.length - 1 || s[i + 1]!.v < x.v) pts.push({ t: x.v, n: i + 1, tp }); });
  const best = (minP: number) => pts.filter((p) => p.tp / p.n >= minP).sort((x, y) => y.tp - x.tp || y.t - x.t)[0];
  const f1 = pts.map((p) => ({ ...p, f: (2 * p.tp) / (p.n + g) })).sort((x, y) => y.f - x.f)[0]!;
  // AUC-PR proxy: average precision.
  let ap = 0; tp = 0; s.forEach((x, i) => { if (x.g) { tp++; ap += tp / (i + 1); } });
  return { g, p100: best(1), p90: best(0.9), f1, ap: ap / g, pts };
}
// Nearest cached neighbour per new question: the cache as it would actually run.
function nn(m: Method, t: number) {
  let used = 0, right = 0;
  for (let a = 0; a < Q.length; a++) {
    let bb = -1, bv = -Infinity;
    for (let b = 0; b < Q.length; b++) if (b !== a && Q[b]!.book === Q[a]!.book && m.sim(a, b) > bv) { bv = m.sim(a, b); bb = b; }
    if (bv >= t) { used++; if (good(a, bb)) right++; }
  }
  return { used, right };
}
const servable = Q.filter((_, a) => pairs.some(([x, b]) => x === a && good(a, b))).length;
const fmt = (p?: { t: number; n: number; tp: number }) => (p ? `t=${p.t.toFixed(3)} ${p.tp}/${p.n} R=${((p.tp / G) * 100).toFixed(0)}%` : "none");
console.log(`${Q.length} questions, ${pairs.length} ordered same-book pairs, ${G} good; ${servable} questions have at least one good cached partner`);
console.log("method | AP | best @P=100% | best @P>=90% | best F1 (t, judged, P, R) | NN@P100-t: reused/right | F-tuned t on C (P,R)");
const rows = methods.map((m) => {
  const w = sweep(m, pairs);
  const n = w.p100 ? nn(m, w.p100.t) : { used: 0, right: 0 };
  // Transfer: threshold at P>=90% on Fallout pairs, applied to Cyberpunk pairs.
  const F = pairs.filter(([a]) => Q[a]!.book === "F"), C = pairs.filter(([a]) => Q[a]!.book === "C");
  const tf = sweep(m, F).p90?.t ?? Infinity;
  const cj = C.filter(([a, b]) => m.sim(a, b) >= tf), cg = C.filter(([a, b]) => good(a, b)).length;
  const ctp = cj.filter(([a, b]) => good(a, b)).length;
  return { m, w, line: `${m.name} | ${w.ap.toFixed(3)} | ${fmt(w.p100)} | ${fmt(w.p90)} | t=${w.f1.t.toFixed(3)} ${w.f1.n} P=${((w.f1.tp / w.f1.n) * 100).toFixed(0)}% R=${((w.f1.tp / G) * 100).toFixed(0)}% | ${n.used}/${n.right} | t=${tf.toFixed(3)} ${ctp}/${cj.length} R=${((ctp / cg) * 100).toFixed(0)}%` };
});
rows.sort((x, y) => y.w.ap - x.w.ap).forEach((r) => console.log(r.line));
if (process.argv[2]) { // threshold table for named methods
  for (const r of rows.filter((r) => process.argv.slice(2).some((n) => r.m.name === n))) {
    console.log(`\n${r.m.name}`);
    const ts = r.w.pts.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 14)) === 0);
    for (const p of ts.slice(0, 14)) console.log(`  t>=${p.t.toFixed(3)}: judged ${p.n}, good ${p.tp} (P ${((p.tp / p.n) * 100).toFixed(0)}%), recall ${((p.tp / G) * 100).toFixed(0)}%`);
  }
}
