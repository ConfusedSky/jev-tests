// Where good and bad pairs sit against the adopted OR rule (qi~rich ≥ 0.53 or s~s ≥ 0.80, Qwen3-4B Q4), for the
// UI's "weak match" margin: in sample, and out of sample with the bars refitted without the question (or the book).
// Needs embs2/ollama_qwen3-embedding-4b.json (ollama2.ts). `bun experiments/ranking-cache/margin.ts`
type Rq = { q: string; book: string; re: string; ranking: string[]; own: number };
const Q = ((await Bun.file(import.meta.dir + "/rankings.json").json()) as { questions: Rq[] }).questions;
const at = (r: string[], re: RegExp) => { const i = r.findIndex((p) => re.test(p.split(" > ").at(-1)!)); return i < 0 ? 99 : i + 1; };
const rankIn = (a: number, b: number) => at(Q[b]!.ranking, new RegExp(Q[a]!.re));
const good = (a: number, b: number) => rankIn(a, b) <= (Q[a]!.own === 99 ? 5 : Math.max(5, Q[a]!.own));
const cos = (x: number[], y: number[]) => { let d = 0, nx = 0, ny = 0; for (let i = 0; i < x.length; i++) { d += x[i]! * y[i]!; nx += x[i]! ** 2; ny += y[i]! ** 2; } return d / Math.sqrt(nx * ny); };
const e = await Bun.file(import.meta.dir + "/embs2/ollama_qwen3-embedding-4b.json").json();
const BAR = { A: 0.53, B: 0.8 };
const MAX = 12; // the walk's --max sections: a ranking whose answer sits deeper is never read
type P = { a: number; b: number; A: number; B: number; g: boolean; cached: number; own: number };
const ps: P[] = [];
for (let a = 0; a < Q.length; a++) for (let b = 0; b < Q.length; b++) if (a !== b && Q[a]!.book === Q[b]!.book) ps.push({ a, b, A: cos(e.qi[a], e.rich[b]), B: cos(e.s[a], e.s[b]), g: good(a, b), cached: rankIn(a, b), own: Q[a]!.own });
// A hit's distance above the rule: the larger of the two scores' distances above their bars; below 0 is a miss.
const over = (p: P, bar = BAR) => Math.max(p.A - bar.A, p.B - bar.B);
const f3 = (x: number) => (x >= 0 ? "+" : "") + x.toFixed(3);
const who = (p: P) => `${Q[p.a]!.q} <- ${Q[p.b]!.q}`;

console.log(`${ps.length} pairs, ${ps.filter((p) => p.g).length} good\n`);
console.log("## Pairs by distance from each bar (0.02 bands; g = good, x = bad)");
const bands = (k: string, d: (p: P) => number) => {
  console.log(`\n${k}`);
  for (let lo = -0.16; lo < 0.3; lo += 0.02) {
    const inBand = ps.filter((p) => d(p) >= lo - 1e-9 && d(p) < lo + 0.02 - 1e-9), g = inBand.filter((p) => p.g).length, x = inBand.length - g;
    console.log(`  ${f3(lo).padStart(6)}..${f3(lo + 0.02).padStart(6)}  good ${String(g).padStart(2)}  bad ${String(x).padStart(3)}  ${"g".repeat(g)}${"x".repeat(Math.min(x, 60))}${x > 60 ? "…" : ""}`);
  }
  const hi = ps.filter((p) => d(p) >= 0.3), lo = ps.filter((p) => d(p) < -0.16);
  console.log(`  ≥ +0.300         good ${hi.filter((p) => p.g).length}  bad ${hi.filter((p) => !p.g).length};  < -0.160: good ${lo.filter((p) => p.g).length}  bad ${lo.filter((p) => !p.g).length}`);
};
bands("whole question minus 0.53", (p) => p.A - BAR.A);
bands("subject minus 0.80", (p) => p.B - BAR.B);
bands("the rule: max of the two", (p) => over(p));

console.log("\n## The rule's distance in the doc's bands");
for (const [lo, hi] of [[-0.1, -0.05], [-0.05, 0], [0, 0.03], [0.03, 0.05], [0.05, 0.1], [0.1, 9]]) {
  const b = ps.filter((p) => over(p) >= lo && over(p) < hi);
  console.log(`  ${f3(lo)}..${hi === 9 ? "      " : f3(hi)}  good ${b.filter((p) => p.g).length}  bad ${b.filter((p) => !p.g).length}`);
}

console.log("\n## The wrong pairs closest to the rule");
for (const p of ps.filter((p) => !p.g).sort((x, y) => over(y) - over(x)).slice(0, 10)) console.log(`  ${f3(over(p))}  (whole ${f3(p.A - BAR.A)}, subject ${f3(p.B - BAR.B)})  cached rank ${p.cached}, own ${p.own}  ${who(p)}`);

console.log("\n## Every accepted pair, weakest first: does the cached ranking reach the answer within --max, and would a fresh one?");
const acc = ps.filter((p) => over(p) >= 0).sort((x, y) => over(x) - over(y));
for (const p of acc) console.log(`  ${f3(over(p))}  ${p.g ? "good" : "BAD "}  by ${p.A >= BAR.A ? (p.B >= BAR.B ? "both   " : "whole  ") : "subject"}  whole ${p.A.toFixed(3)} subject ${p.B.toFixed(3)}  cached rank ${String(p.cached).padStart(2)}, own ${String(p.own).padStart(2)}  ${who(p)}`);

// Refitting the bars as the doc did: the grid cell at 100% precision with the most good pairs, the widest margin
// breaking ties, then 0.01 added to each (0.52/0.79 became 0.53/0.80).
const range = (lo: number, hi: number, st: number) => { const r: number[] = []; for (let x = lo; x <= hi + 1e-9; x += st) r.push(+x.toFixed(3)); return r; };
function fit(train: P[]) {
  const bad = train.filter((p) => !p.g);
  let best = { A: 1, B: 1, tp: -1, margin: -1 };
  for (const A of range(0.45, 0.65, 0.01)) for (const B of range(0.7, 1.0, 0.01)) {
    const hit = train.filter((p) => p.A >= A || p.B >= B);
    if (hit.some((p) => !p.g)) continue;
    const margin = Math.min(A - Math.max(-1, ...bad.filter((p) => p.B < B).map((p) => p.A)), B - Math.max(-1, ...bad.filter((p) => p.A < A).map((p) => p.B)));
    if (hit.length > best.tp || (hit.length === best.tp && margin > best.margin)) best = { A, B, tp: hit.length, margin };
  }
  return { A: +(best.A + 0.01).toFixed(2), B: +(best.B + 0.01).toFixed(2) };
}
type T = P & { d: number; bar: { A: number; B: number } };
const loqo: T[] = [];
for (let h = 0; h < Q.length; h++) {
  const bar = fit(ps.filter((p) => p.a !== h && p.b !== h));
  for (const p of ps.filter((p) => p.a === h)) loqo.push({ ...p, d: over(p, bar), bar });
}
const books: T[] = [];
for (const [from, to] of [["F", "C"], ["C", "F"]]) {
  const bar = fit(ps.filter((p) => Q[p.a]!.book === from));
  console.log(`\nbars fitted on ${from}: whole ${bar.A}, subject ${bar.B}; applied to ${to}`);
  for (const p of ps.filter((p) => Q[p.a]!.book === to)) books.push({ ...p, d: over(p, bar), bar });
}
const bars = new Map(loqo.map((t) => [`${t.bar.A}/${t.bar.B}`, 0]));
for (const t of loqo) bars.set(`${t.bar.A}/${t.bar.B}`, bars.get(`${t.bar.A}/${t.bar.B}`)! + 1);
console.log(`leave-one-question-out bars (whole/subject: pairs tested): ${[...bars].map(([k, n]) => `${k}: ${n}`).join(", ")}`);

console.log("\n## Out of sample: accepted pairs by distance above their refitted bars");
for (const [name, set] of [["leave one question out", loqo], ["fitted on one book, applied to the other", books]] as const) {
  const hits = set.filter((t) => t.d >= 0);
  console.log(`\n${name}: ${hits.filter((t) => t.g).length}/${hits.length} right`);
  for (const [lo, hi] of [[0, 0.02], [0.02, 0.05], [0.05, 0.1], [0.1, 0.2], [0.2, 9]]) {
    const b = hits.filter((t) => t.d >= lo && t.d < hi);
    console.log(`  +${lo.toFixed(2)}..${hi === 9 ? "   " : `+${hi.toFixed(2)}`}  ${b.filter((t) => t.g).length}/${b.length} right`);
  }
  for (const t of hits.filter((t) => !t.g)) console.log(`  wrong at ${f3(t.d)} (bars ${t.bar.A}/${t.bar.B}; whole ${t.A.toFixed(3)} subject ${t.B.toFixed(3)}) cached rank ${t.cached}, own ${t.own}  ${who(t)}`);
}

console.log("\n## Margins: a hit is weak when its distance above the rule is under m");
console.log("   m      in sample: weak/accepted | LOQO: wrong caught, good flagged | book transfer: wrong caught, good flagged");
const row = (m: number, weak: (t: T) => boolean, label: string) => {
  const s = acc.filter((p) => weak({ ...p, d: over(p), bar: BAR }));
  const cell = (set: T[]) => { const h = set.filter((t) => t.d >= 0), w = h.filter(weak); return `${w.filter((t) => !t.g).length}/${h.filter((t) => !t.g).length}, ${w.filter((t) => t.g).length}/${h.filter((t) => t.g).length}`; };
  console.log(`  ${label.padEnd(26)} ${String(s.length).padStart(2)}/${acc.length}             | ${cell(loqo).padEnd(28)} | ${cell(books)}`);
};
for (const m of [0.01, 0.02, 0.03, 0.05, 0.075, 0.1, 0.15]) row(m, (t) => t.d < m, `rule, m = ${m}`);
// The UI as built: the whole question alone within 0.1 of its bar, so every hit the subject carries is weak.
row(0.1, (t) => t.A < t.bar.A + 0.1, "whole only, 0.1 (as built)");

console.log("\n## Would ranking afresh reach an answer the cached ranking does not, within --max? (accepted pairs)");
for (const [name, set] of [["in sample", acc.map((p) => ({ ...p, d: over(p), bar: BAR }))], ["LOQO", loqo.filter((t) => t.d >= 0)], ["book transfer", books.filter((t) => t.d >= 0)]] as const) {
  const miss = set.filter((t) => t.cached > MAX), rescued = miss.filter((t) => t.own <= MAX), worse = set.filter((t) => t.cached > t.own);
  console.log(`  ${name}: ${set.length} hits; cached ranking past --max ${miss.length} (fresh within it ${rescued.length}); cached ranks the answer lower than fresh ${worse.length}`);
  for (const t of worse) console.log(`     ${f3(t.d)} cached rank ${t.cached}, own ${t.own}  ${who(t)}`);
}
