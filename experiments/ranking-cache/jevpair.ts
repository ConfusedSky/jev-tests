import { noul } from "@typesafe-ai/sdk";
import { DEFAULT_MODEL, makeClient, tokens } from "../../shared";
const R = (await Bun.file(import.meta.dir + "/rankings.json").json()) as { questions: { q: string; book: string }[] };
const Q = R.questions;
const client = await makeClient(DEFAULT_MODEL);
const pairs: [number, number][] = [];
for (let a = 0; a < Q.length; a++) for (let b = 0; b < Q.length; b++) if (a !== b && Q[a]!.book === Q[b]!.book) pairs.push([a, b]);
const p: Record<string, number> = {};
const t0 = tokens.in, s0 = performance.now();
const lat: number[] = [];
for (let i = 0; i < pairs.length; i += 20) {
  const chunk = pairs.slice(i, i + 20);
  const s = performance.now();
  const res = await client.systemOne({
    state: { question: "" },
    questions: Object.fromEntries(chunk.map(([a, b]) => [`p${a}_${b}`, noul(`The same sections of a rulebook would answer "${Q[a]!.q}" as answer "${Q[b]!.q}"`)])),
  });
  lat.push(performance.now() - s);
  for (const [a, b] of chunk) p[`${a},${b}`] = (res.answers as any)[`p${a}_${b}`].noul;
}
lat.sort((a, b) => a - b);
await Bun.write(import.meta.dir + "/jevpairs.json", JSON.stringify({ p, tokensPerPair: (tokens.in - t0) / pairs.length, msPer20: lat[lat.length >> 1], totalMs: performance.now() - s0 }));
console.log(pairs.length, "pairs", ((tokens.in - t0) / pairs.length).toFixed(1), "tok/pair; median ms per call of 20:", Math.round(lat[lat.length >> 1]!), "$", ((tokens.in - t0) * 0.042 / 1e6).toFixed(4));
