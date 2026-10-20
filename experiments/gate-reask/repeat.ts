// Asks one window's gate several times over identical input, to see whether
// jev's answer moves at all when nothing it is shown changes.
//   bun experiments/gate-reask/repeat.ts PDF PAGE "QUESTION" [N]
import { noul } from "@typesafe-ai/sdk";
import { DEFAULT_MODEL, makeClient, tokens } from "../../shared";

const [pdf, page, question, n = "6"] = Bun.argv.slice(2);
const text = await Bun.$`pdftotext -layout -f ${page} -l ${page} ${pdf} -`.text();
const client = await makeClient(DEFAULT_MODEL);
const ask = () =>
  client.systemOne({ state: { question, section: "Ammunition", text }, questions: { g: noul("`text` contains the answer to `question`") } });
const serial: number[] = [];
for (let i = 0; i < Number(n); i++) serial.push(((await ask()).answers as Record<string, { noul: number }>).g!.noul);
const parallel = (await Promise.all(Array.from({ length: Number(n) }, ask))).map((r) => (r.answers as Record<string, { noul: number }>).g!.noul);
console.log("serial  ", serial.map((p) => p.toFixed(3)).join(" "));
console.log("parallel", parallel.map((p) => p.toFixed(3)).join(" "));
console.log(`tokens in ${tokens.in}`);
