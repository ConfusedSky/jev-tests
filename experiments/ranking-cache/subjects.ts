import { readQuestion } from "../../answer";
import { DEFAULT_MODEL, makeClient, tokens } from "../../shared";
const R = (await Bun.file(import.meta.dir + "/rankings.json").json()) as { questions: { q: string }[] };
const client = await makeClient(DEFAULT_MODEL);
const out = await Promise.all(R.questions.map(async ({ q }) => ({ q, ...(await readQuestion(client, q)) })));
await Bun.write(import.meta.dir + "/subjects.json", JSON.stringify({ tokensPerQuestion: tokens.in / out.length, readings: out }, null, 1));
for (const [i, r] of out.entries()) console.log(i, r.kind, JSON.stringify(r.subject), JSON.stringify(r.quantities), JSON.stringify(r.counted), "|", r.q);
console.log("tokens/question", Math.round(tokens.in / out.length));
