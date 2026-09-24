// Combines qi~rich (A) with s~s (B): AND, OR and weighted sum, on the same pairs and labels.
type Rq = { q: string; book: string; re: string; ranking: string[]; own: number };
const Q = ((await Bun.file(import.meta.dir + "/rankings.json").json()) as { questions: Rq[] }).questions;
const at = (r: string[], re: RegExp) => { const i = r.findIndex((p) => re.test(p.split(" > ").at(-1)!)); return i < 0 ? 99 : i + 1; };
const good = (a: number, b: number) => at(Q[b]!.ranking, new RegExp(Q[a]!.re)) <= (Q[a]!.own === 99 ? 5 : Math.max(5, Q[a]!.own));
const all: [number, number][] = [];
for (let a = 0; a < Q.length; a++) for (let b = 0; b < Q.length; b++) if (a !== b && Q[a]!.book === Q[b]!.book) all.push([a, b]);
const cos = (x: number[], y: number[]) => { let d = 0, nx = 0, ny = 0; for (let i = 0; i < x.length; i++) { d += x[i]! * y[i]!; nx += x[i]! ** 2; ny += y[i]! ** 2; } return d / Math.sqrt(nx * ny); };
const range = (lo: number, hi: number, st: number) => { const r: number[] = []; for (let x = lo; x <= hi + 1e-9; x += st) r.push(+x.toFixed(3)); return r; };
type P = { A: number; B: number; g: boolean; a: number; b: number; book: string };
const pct = (x: number, n: number) => `${Math.round((x / n) * 100)}%`;
const probe: [number, number][] = [[11, 9], [9, 11], [3, 9], [13, 11], [11, 13], [12, 13], [7, 6], [6, 7], [8, 6], [2, 3], [3, 5], [24, 23], [24, 25], [15, 8], [22, 26], [26, 27], [7, 8], [16, 2], [9, 10]];
const TARGET = process.argv[2] ?? "ollama_qwen3-embedding-4b";
for (const f of ["ollama_qwen3-embedding-4b", "local_Qwen3-Embedding-0.6B", "or_text-embedding-3-small"]) {
  const e = await Bun.file(`${import.meta.dir}/embs2/${f}.json`).json();
  const qk = f.startsWith("or_") ? "q" : "qi"; // 3-small did best without the prefix
  const ps: P[] = all.map(([a, b]) => ({ A: cos(e[qk][a], e.rich[b]), B: cos(e.s[a], e.s[b]), g: good(a, b), a, b, book: Q[a]!.book }));
  const G = ps.filter((p) => p.g).length;
  console.log(`\n#### ${f}  (A = ${qk}~rich, B = s~s; ${G} good of ${ps.length})`);
  const score = (hit: (p: P) => boolean, set = ps) => { const j = set.filter(hit); return { n: j.length, tp: j.filter((p) => p.g).length }; };
  const bad = ps.filter((p) => !p.g);
  // Single-signal references with their 100%-precision margin (threshold minus the top wrong score).
  for (const [k, lab] of [["A", `${qk}~rich`], ["B", "s~s"]] as const) {
    const vals = [...new Set(ps.map((p) => p[k]))].sort((x, y) => y - x);
    const maxBad = Math.max(...bad.map((p) => p[k]));
    const t = vals.filter((v) => v > maxBad).at(-1)!;
    const s = score((p) => p[k] >= t);
    console.log(`alone ${lab}: P=100% best t=${t.toFixed(3)} ${s.tp}/${s.n} R=${pct(s.tp, G)}; top wrong at ${maxBad.toFixed(3)} (margin ${(t - maxBad).toFixed(3)})`);
  }
  type C = { rule: string; hit: (p: P) => boolean; margin: number };
  function frontier(name: string, cands: C[]) {
    const scored = cands.map((c) => ({ ...c, ...score(c.hit) }));
    for (const lvl of [1, 0.95, 0.9]) {
      const ok = scored.filter((s) => s.n > 0 && s.tp / s.n >= lvl);
      const best = Math.max(...ok.map((s) => s.tp));
      const top = ok.filter((s) => s.tp === best).sort((x, y) => y.margin - x.margin);
      console.log(`${name} P${lvl === 1 ? "=100" : ">=" + lvl * 100}%: best ${best}/${top[0]!.n} R=${pct(best, G)} at ${top[0]!.rule} (margin ${top[0]!.margin.toFixed(3)}); ${top.length} grid cells reach it`);
    }
    return scored;
  }
  // AND margins: how far each threshold can drop, holding the other, before a wrong pair gets in.
  const andC: C[] = [];
  for (const a of range(0.4, 0.6, 0.01)) for (const b of range(0.5, 0.9, 0.01)) {
    const ma = a - Math.max(-1, ...bad.filter((p) => p.B >= b).map((p) => p.A));
    const mb = b - Math.max(-1, ...bad.filter((p) => p.A >= a).map((p) => p.B));
    andC.push({ rule: `A>=${a} AND B>=${b} (mA ${ma.toFixed(3)}, mB ${mb.toFixed(3)})`, hit: (p) => p.A >= a && p.B >= b, margin: Math.min(ma, mb) });
  }
  const andS = frontier("AND", andC);
  const orC: C[] = [];
  for (const a of range(0.45, 0.65, 0.01)) for (const b of range(0.7, 1.0, 0.01)) {
    const ma = a - Math.max(-1, ...bad.filter((p) => p.B < b).map((p) => p.A));
    const mb = b - Math.max(-1, ...bad.filter((p) => p.A < a).map((p) => p.B));
    orC.push({ rule: `A>=${a} OR B>=${b} (mA ${ma.toFixed(3)}, mB ${mb.toFixed(3)})`, hit: (p) => p.A >= a || p.B >= b, margin: Math.min(ma, mb) });
  }
  frontier("OR ", orC);
  const wC: C[] = [];
  for (const w of range(0, 1, 0.05)) {
    const v = (p: P) => w * p.A + (1 - w) * p.B;
    const maxBad = Math.max(...bad.map(v));
    for (const t of [...new Set(ps.map(v))]) wC.push({ rule: `${w}*A+${(1 - w).toFixed(2)}*B >= ${t.toFixed(3)}`, hit: (p) => v(p) >= t, margin: t - maxBad });
  }
  frontier("SUM", wC);
  // Transfer: choose AND cell on Fallout at P>=90% (most good, then widest margin), apply to CPR.
  const F = ps.filter((p) => p.book === "F"), Cp = ps.filter((p) => p.book === "C"), cg = Cp.filter((p) => p.g).length;
  const fs = andC.map((c) => ({ c, ...score(c.hit, F) })).filter((s) => s.n && s.tp / s.n >= 0.9).sort((x, y) => y.tp - x.tp || y.c.margin - x.c.margin)[0]!;
  const cs = score(fs.c.hit, Cp);
  console.log(`transfer AND: Fallout pick ${fs.c.rule.split(" (")[0]} (F ${fs.tp}/${fs.n}) -> CPR ${cs.tp}/${cs.n} R=${pct(cs.tp, cg)}`);
  for (const [k, lab] of [["A", "A alone"], ["B", "B alone"]] as const) {
    const ts = [...new Set(F.map((p) => p[k]))].map((t) => ({ t, ...score((p) => p[k] >= t, F) })).filter((s) => s.tp / s.n >= 0.9).sort((x, y) => y.tp - x.tp || y.t - x.t)[0]!;
    const c2 = score((p) => p[k] >= ts.t, Cp);
    console.log(`transfer ${lab}: t=${ts.t.toFixed(3)} (F ${ts.tp}/${ts.n}) -> CPR ${c2.tp}/${c2.n} R=${pct(c2.tp, cg)}`);
  }
  if (f === TARGET && process.argv[3]) {
    const [ra, rb] = process.argv[3].split(",").map(Number) as [number, number];
    console.log(`\nnear-miss pairs, AND rule A>=${ra} B>=${rb} vs A alone >=0.50 vs B alone >=0.80`);
    for (const [a, b] of probe) { const p = ps.find((x) => x.a === a && x.b === b)!; console.log(`  ${p.g ? "good" : "bad "} A ${p.A.toFixed(3)} B ${p.B.toFixed(3)} | A:${p.A >= 0.5 ? "Y" : "-"} B:${p.B >= 0.8 ? "Y" : "-"} AND:${p.A >= ra && p.B >= rb ? "Y" : "-"} OR:${p.A >= 0.52 || p.B >= 0.79 ? "Y" : "-"} | ${Q[a]!.q} <- ${Q[b]!.q}`); }
    console.log("  all wrong pairs with A>=0.40 or B>=0.70:");
    for (const p of bad.filter((p) => p.A >= 0.4 || p.B >= 0.7).sort((x, y) => y.A - x.A)) console.log(`   A ${p.A.toFixed(3)} B ${p.B.toFixed(3)} ${Q[p.a]!.q} <- ${Q[p.b]!.q}`);
  }
}
