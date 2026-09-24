// Subject-based texts for the follow-up; keys are embedded as-is by every model.
import base, { QINSTR } from "./texts";
const R = (await Bun.file(import.meta.dir + "/rankings.json").json()) as { questions: { ranking: string[] }[] };
const S = (await Bun.file(import.meta.dir + "/subjects.json").json()).readings as { kind: string; subject: string[]; quantities: string[]; counted: string }[];
const top3 = (i: number) => `\nSections: ${R.questions[i]!.ranking.slice(0, 3).join("; ")}`;
const s = S.map((r) => r.subject.join(", "));
const sq = S.map((r) => [r.subject.join(", "), r.quantities.join(", "), r.kind === "count" && r.counted ? `how many ${r.counted}` : ""].filter(Boolean).join("; "));
const texts = {
  q: base.q, qi: base.qi, rich: base.rich,
  s, si: s.map((x) => QINSTR + x), srich: s.map((x, i) => x + top3(i)),
  sq, sqi: sq.map((x) => QINSTR + x), sqrich: sq.map((x, i) => x + top3(i)),
};
await Bun.write(import.meta.dir + "/texts2.json", JSON.stringify(texts, null, 1));
