const texts = await Bun.file(import.meta.dir + "/texts2.json").json() as Record<string, string[]>;
const models = ["openai/text-embedding-3-small"];
async function embed(model: string, input: string[]) {
  const s = performance.now();
  const r = await fetch("https://openrouter.ai/api/v1/embeddings", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, input }) });
  const j: any = await r.json();
  if (!j.data) throw new Error(`${model}: ${JSON.stringify(j).slice(0, 300)}`);
  return { vecs: j.data.sort((a: any, b: any) => a.index - b.index).map((d: any) => d.embedding as number[]), ms: performance.now() - s, usage: j.usage };
}
for (const model of models) {
  try {
    const out: Record<string, unknown> = { model };
    let cost = 0, tok = 0;
    for (const k of Object.keys(texts)) { const e = await embed(model, texts[k]); out[k] = e.vecs; cost += e.usage?.cost ?? 0; tok += e.usage?.prompt_tokens ?? 0; }
    // Latency of one query as the cache would issue it: a single short text, median of 5.
    const lat: number[] = [];
    for (let i = 0; i < 5; i++) lat.push((await embed(model, [texts.q[i]!])).ms);
    lat.sort((a, b) => a - b);
    Object.assign(out, { costPerQuery: cost / texts.q.length / Object.keys(texts).length, tokensPerQuery: tok / texts.q.length / Object.keys(texts).length, msPerQuery: lat[2], dim: (out.q as number[][])[0]!.length });
    await Bun.write(`${import.meta.dir}/embs2/or_${model.split("/")[1]}.json`, JSON.stringify(out));
    console.log(model, "dim", out.dim, "ms", Math.round(lat[2]!), "$/query", (out.costPerQuery as number).toExponential(2));
  } catch (e) { console.log("FAIL", String(e)); }
}
