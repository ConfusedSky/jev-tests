// A preload that logs every ranking-cache lookup and store to $JEV_TRACE as JSON lines, since the bench runs quiet:
//   JEV_TRACE=/tmp/on.jsonl bun --preload ./experiments/ranking-cache/trace.ts bench.ts --cache qwen3-4b --no-save
// It rewrites cache.ts as it loads, wrapping `rankingCache`; a lookup also records the nearest entry with no bar,
// to show how far a miss fell short. bench.ts and cache.ts are left as they are.
import { plugin } from "bun";

const out = process.env.JEV_TRACE;
if (!out) throw new Error("set JEV_TRACE to the file to write");

plugin({
  name: "trace-ranking-cache",
  setup(build) {
    build.onLoad({ filter: /\/cache\.ts$/ }, async ({ path }) => {
      const src = await Bun.file(path).text();
      if (!src.includes("export function rankingCache(")) throw new Error(`${path} no longer declares rankingCache`);
      const wrap = `
import { appendFileSync as __append } from "node:fs";
{
  const inner = rankingCache;
  const log = (r: object) => __append(${JSON.stringify(out)}, JSON.stringify({ at: new Date().toISOString(), ...r }) + "\\n");
  const brief = (f: Found | undefined) => f && { question: f.entry.question, whole: +f.whole.toFixed(4), subject: +f.subject.toFixed(4) };
  rankingCache = (m: CacheModel, embed: Embed, dir: string, question: string, subject: string[]): RankingCache => {
    const c = inner(m, embed, dir, question, subject);
    const open = inner({ ...m, whole: -2, subject: 2 }, embed, dir, question, subject);
    return {
      async lookup(pdf) {
        const found = await c.lookup(pdf);
        const nearest = await open.lookup(pdf);
        log({ op: "lookup", question, subject, pdf, bars: { whole: m.whole, subject: m.subject }, found: brief(found), nearest: brief(nearest) });
        return found;
      },
      async store(pdf, ranking) {
        log({ op: "store", question, subject, pdf, ranked: ranking.all.length });
        return c.store(pdf, ranking);
      },
    };
  };
}
`;
      return { contents: src + wrap, loader: "ts" };
    });
  },
});
