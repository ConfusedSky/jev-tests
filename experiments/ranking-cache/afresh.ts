// Joins a bench run with the cache on (and its trace.ts log) to runs ranking afresh, case by case: which cached
// match each case walked, how far above the rule it sat, and whether ranking afresh did better.
//   bun experiments/ranking-cache/afresh.ts TRACE.jsonl ON.out OFF.out [OFF2.out …]
// ON/OFF are the bench's stdout; with several OFF runs a case's afresh score is its best, since several vary run to run.
// A table request looks up under its own questions, not the case's, so lookups are placed in cases by time: the
// bench prints each case's duration, and the lookups whose question is their case's fix where the run began.
const [trace, on, ...offs] = process.argv.slice(2);
if (!trace || !on || offs.length === 0) throw new Error("usage: afresh.ts TRACE.jsonl ON.out OFF.out [OFF2.out …]");
const BOOKS: Record<string, string> = { JEV_HEART_PDF: "heart", JEV_FALLOUT_PDF: "fallout", JEV_LITM_PDF: "litm", JEV_CPR_PDF: "cpr" };
const book = (pdf: string) => Object.entries(BOOKS).find(([v]) => process.env[v] === pdf)?.[1] ?? pdf.split("/").pop()!;
const BAR = { whole: 0.53, subject: 0.8 };

// The bench's table: fixed columns, the case cut to 52 characters.
type Row = { label: string; p: number | undefined; score: number; ms: number; start: number };
const rows = async (file: string): Promise<Row[]> => {
  let start = 0;
  return (await Bun.file(file).text())
    .split("\n")
    .filter((l) => /^(heart|fallout|litm|cpr|shelf): /.test(l))
    .map((l) => {
      const ms = Number(l.slice(111, 117).replace("s", "")) * 1000;
      const r = { label: l.slice(0, 52).trim(), p: Number(l.slice(87, 92)) || undefined, score: parseInt(l.slice(99, 103)) / 100, ms, start };
      start += ms;
      return r;
    });
};

type Hit = { question: string; whole: number; subject: number };
type Lookup = { op: "lookup"; at: string; question: string; pdf: string; found?: Hit; nearest?: Hit };
const lookups = (await Bun.file(trace).text()).trim().split("\n").map((l) => JSON.parse(l) as Lookup | { op: "store" }).filter((r): r is Lookup => r.op === "lookup");
const onRows = await rows(on);
const offRows = await Promise.all(offs.map(rows));
const t = (l: Lookup) => Date.parse(l.at);

// A lookup asked under its case's own question belongs to it: matched in order, one to a case. They fix the clock,
// and every other lookup goes to the case running at its time, between the matched cases either side of it.
const rowOf = new Map<Lookup, number>();
const offsets: number[] = [];
let from = 0;
for (const [i, r] of onRows.entries()) {
  const prefix = r.label.replace(/…$/, "");
  const j = lookups.findIndex((l, k) => k >= from && `${book(l.pdf)}: ${l.question}`.startsWith(prefix));
  if (j < 0) continue;
  rowOf.set(lookups[j]!, i);
  offsets.push(t(lookups[j]!) - r.start - r.ms / 2);
  from = j + 1;
}
const t0 = offsets.sort((a, b) => a - b)[Math.floor(offsets.length / 2)]!;
for (const [j, l] of lookups.entries()) {
  if (rowOf.has(l)) continue;
  const lo = Math.max(0, ...lookups.slice(0, j).map((x) => rowOf.get(x) ?? 0));
  const hi = Math.min(onRows.length - 1, ...lookups.slice(j + 1).map((x) => rowOf.get(x) ?? Infinity));
  rowOf.set(l, Math.min(hi, Math.max(lo, onRows.findLastIndex((r) => t0 + r.start <= t(l)))));
}
const caseOf = (l: Lookup) => rowOf.get(l)!;

const over = (h: Hit) => Math.max(h.whole - BAR.whole, h.subject - BAR.subject);
const f2 = (x: number) => x.toFixed(2);
for (const [i, r] of onRows.entries()) {
  const mine = lookups.filter((l) => caseOf(l) === i);
  const afresh = offRows.map((o) => o[i]!);
  if (afresh.some((o) => o.label !== r.label)) throw new Error(`row ${i}: runs disagree on the case (${r.label})`);
  const best = Math.max(...afresh.map((o) => o.score));
  // The UI offers its retry when a walk off a cached ranking took nothing at the answer floor.
  const missed = !r.label.startsWith("shelf:") && (r.p === undefined || r.p < 0.7);
  const cache = mine.length === 0 ? ["no lookup (the contents confined it)"] : mine.map((l) => (l.found ? `hit ${f2(l.found.whole)}/${l.found.subject < 0 ? "–" : f2(l.found.subject)}, ${over(l.found) >= 0 ? "+" : ""}${f2(over(l.found))} over <- ${l.found.question}${l.question === r.label.replace(/^\w+: /, "") ? "" : ` (for "${l.question}")`}` : `miss, nearest ${f2(l.nearest?.whole ?? 0)}/${f2(l.nearest?.subject ?? 0)}`));
  console.log(`${r.label.padEnd(52)} on ${String(Math.round(r.score * 100)).padStart(3)}% ${missed ? "miss" : "    "}  afresh ${afresh.map((o) => `${Math.round(o.score * 100)}%`.padStart(4)).join(" ")}${mine.some((l) => l.found) && best - r.score > 0.05 ? "  ↑" : "   "}  ${cache.join("; ")}`);
}
const hits = lookups.filter((l) => l.found);
console.log(`\n${lookups.length} lookups, ${hits.length} hits; distance over the rule of each hit, weakest first:`);
console.log(`  ${hits.map((l) => over(l.found!)).sort((a, b) => a - b).map(f2).join(" ")}`);
console.log(`hits the UI as built calls weak (whole < ${BAR.whole} + 0.1): ${hits.filter((l) => l.found!.whole < BAR.whole + 0.1).length}; ` +
  `of them the same question: ${hits.filter((l) => l.found!.whole < BAR.whole + 0.1 && l.found!.question.toLowerCase() === l.question.toLowerCase()).length}`);
