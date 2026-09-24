// The texts every embedding method sees, written once so Python and Bun agree.
const R = (await Bun.file(import.meta.dir + "/rankings.json").json()) as { questions: { q: string; ranking: string[] }[] };
export const QINSTR = "Instruct: Given a question about a tabletop rulebook, retrieve cached questions answered by the same rulebook sections\nQuery: ";
const texts = {
  q: R.questions.map((x) => x.q),
  qi: R.questions.map((x) => QINSTR + x.q),
  rich: R.questions.map((x) => `${x.q}\nSections: ${x.ranking.slice(0, 3).join("; ")}`),
};
if (import.meta.main) await Bun.write(import.meta.dir + "/texts.json", JSON.stringify(texts, null, 1));
export default texts;
