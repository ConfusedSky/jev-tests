type Rq = { q: string; book: string; re: string; ranking: string[]; own: number };
const Q = ((await Bun.file(import.meta.dir + "/rankings.json").json()) as { questions: Rq[] }).questions;
const at = (r: string[], re: RegExp) => { const i = r.findIndex((p) => re.test(p.split(" > ").at(-1)!)); return i < 0 ? 99 : i + 1; };
const good = (a: number, b: number) => at(Q[b]!.ranking, new RegExp(Q[a]!.re)) <= (Q[a]!.own === 99 ? 5 : Math.max(5, Q[a]!.own));
const cos = (x: number[], y: number[]) => { let d = 0, nx = 0, ny = 0; for (let i = 0; i < x.length; i++) { d += x[i]! * y[i]!; nx += x[i]! ** 2; ny += y[i]! ** 2; } return d / Math.sqrt(nx * ny); };
const e = await Bun.file(import.meta.dir + "/embs2/ollama_qwen3-embedding-4b.json").json();
const ps: { A: number; B: number; g: boolean; book: string; a: number; b: number }[] = [];
for (let a = 0; a < Q.length; a++) for (let b = 0; b < Q.length; b++) if (a !== b && Q[a]!.book === Q[b]!.book) ps.push({ A: cos(e.qi[a], e.rich[b]), B: cos(e.s[a], e.s[b]), g: good(a, b), book: Q[a]!.book, a, b });
const sc = (h: (p: (typeof ps)[number]) => boolean, set = ps) => { const j = set.filter(h), g = set.filter((p) => p.g).length, tp = j.filter((p) => p.g).length; return `${tp}/${j.length} R=${Math.round(tp / g * 100)}%`; };
for (const [a, b] of [[0.5, 1.01], [0.52, 0.79], [0.53, 0.8], [0.53, 0.82], [0.55, 0.8], [0.52, 0.85]]) console.log(`A>=${a} OR B>=${b}: all ${sc((p) => p.A >= a || p.B >= b)}`);
// OR transfer: best on Fallout at P>=90% (most good, then highest thresholds), apply to CPR.
const F = ps.filter((p) => p.book === "F"), C = ps.filter((p) => p.book === "C");
let best: [number, number, number] = [0, 0, -1];
for (let a = 0.45; a <= 0.65; a += 0.01) for (let b = 0.7; b <= 1.0; b += 0.01) { const j = F.filter((p) => p.A >= a || p.B >= b), tp = j.filter((p) => p.g).length; if (j.length && tp / j.length >= 0.9 && (tp > best[2] || (tp === best[2] && a + b > best[0] + best[1]))) best = [a, b, tp]; }
console.log(`OR transfer: Fallout pick A>=${best[0].toFixed(2)} OR B>=${best[1].toFixed(2)} F ${sc((p) => p.A >= best[0] || p.B >= best[1], F)} -> CPR ${sc((p) => p.A >= best[0] || p.B >= best[1], C)}`);
// Which pairs does OR add over A alone at 0.52?
for (const p of ps.filter((p) => p.B >= 0.79 && p.A < 0.52)) console.log(`  OR adds: ${p.g ? "good" : "BAD"} A ${p.A.toFixed(3)} B ${p.B.toFixed(3)} ${Q[p.a]!.q} <- ${Q[p.b]!.q}`);
