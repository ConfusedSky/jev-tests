const r = await fetch("https://openrouter.ai/api/v1/embeddings", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "openai/text-embedding-3-small", input: ["hello world", "hi"] }) });
const j: any = await r.json();
console.log(r.status, JSON.stringify(j).slice(0, 300), j.data?.[0]?.embedding?.length, JSON.stringify(j.usage));
const m: any = await (await fetch("https://openrouter.ai/api/v1/embeddings/models")).json().catch(() => null);
console.log(JSON.stringify(m)?.slice(0, 200));
for (const x of m?.data ?? []) if (/openai|qwen|google|bge/i.test(x.id)) console.log(x.id, JSON.stringify(x.pricing));
