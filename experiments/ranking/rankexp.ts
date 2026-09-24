import { score, type JsonValue } from "@typesafe-ai/sdk";
import { outline } from "../../pdf";
import { DEFAULT_MODEL, makeClient, RUBRIC, tokens } from "../../shared";
const client = await makeClient(DEFAULT_MODEL);
const pdf = process.env.JEV_FALLOUT_PDF!;
const paths = (await outline(pdf)).map((s) => s.path);
const SHORT = ["Unrelated", "Related area only", "Plausibly holds part", "Names the subject"] as const;
type V = { name: string; ref: boolean; text: boolean; rubric: readonly string[]; batch: number };
const variants: V[] = [
  { name: "baseline", ref: true, text: true, rubric: RUBRIC, batch: 40 },
  { name: "ref only", ref: true, text: false, rubric: RUBRIC, batch: 40 },
  { name: "text only", ref: false, text: true, rubric: RUBRIC, batch: 40 },
  { name: "short rubric", ref: true, text: true, rubric: SHORT, batch: 40 },
  { name: "ref+short", ref: true, text: false, rubric: SHORT, batch: 40 },
  { name: "batch 120", ref: true, text: true, rubric: RUBRIC, batch: 120 },
];
async function rank(v: V, question: string) {
  const chunks: string[][] = [];
  for (let i = 0; i < paths.length; i += v.batch) chunks.push(paths.slice(i, i + v.batch));
  const before = tokens.in;
  const res = await Promise.all(chunks.map(async (chunk, c) => {
    const questions = Object.fromEntries(chunk.map((p, i) => [`c${i}`, score(
      v.ref && v.text ? `The section \`candidates[${i}]\` ("${p}") answers \`question\`` : v.ref ? `The section \`candidates[${i}]\` answers \`question\`` : `The section "${p}" answers \`question\``,
      v.rubric as any)]));
    const state: Record<string, JsonValue> = { question, ...(v.ref ? { candidates: chunk } : {}) };
    const r = await client.systemOne({ state, questions });
    return chunk.map((p, i) => ({ p, s: (r.answers as any)[`c${i}`].score as number, conf: (r.answers as any)[`c${i}`].confidence as number }));
  }));
  const top = res.flat().sort((a, b) => b.s - a.s || b.conf - a.conf).slice(0, 12).map((x) => x.p);
  return { used: tokens.in - before, top };
}
const Q = ["How is radiation treated?", "How many perks are there?", "Show me the small guns table"];
for (const q of Q) {
  const base = await rank(variants[0]!, q);
  console.log(`\n${q}\n  baseline      ${base.used.toLocaleString().padStart(8)} tokens  top: ${base.top.slice(0, 3).map((p) => p.split(" > ").at(-1)).join(" | ")}`);
  for (const v of variants.slice(1)) {
    const r = await rank(v, q);
    const overlap = r.top.filter((p) => base.top.includes(p)).length;
    console.log(`  ${v.name.padEnd(13)} ${r.used.toLocaleString().padStart(8)} tokens  ${((1 - r.used / base.used) * 100).toFixed(0).padStart(3)}% less  top-12 overlap ${overlap}/12  top: ${r.top.slice(0, 3).map((p) => p.split(" > ").at(-1)).join(" | ")}`);
  }
}
