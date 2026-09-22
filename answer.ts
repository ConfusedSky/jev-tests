import { choice, noul, type ChoiceResponse, type NoulResponse, type TypeSafeClient } from "@typesafe-ai/sdk";
import { timed } from "./shared";

export type Kind = "count" | "truth" | "passage";

/** What shape of answer the question wants, decided once from its wording. */
export async function classify(client: TypeSafeClient, question: string): Promise<Kind> {
  const res = await timed("api", () =>
    client.systemOne({
      state: { question },
      questions: {
        kind: choice("What shape of answer does this question want?", {
          count: "Asks how many, how much, or for some other number",
          truth: "States something that is either true or false, or asks whether something is the case",
          passage: "Asks what, how or why, and wants an explanation or the place it is written",
        }),
      },
    }),
  );
  return (res.answers.kind as ChoiceResponse).choice as Kind;
}

export type Answer = { text: string; p: number };

/** Jev writes no prose, so a count is a choice over the numbers themselves. */
async function countFrom(
  client: TypeSafeClient,
  question: string,
  section: string,
  text: string,
  max: number,
): Promise<Answer> {
  // A Choice takes at most 255 options: 0 through 252, plus the two escapes.
  const ceiling = Math.min(max, 252);
  const criteria: Record<string, string> = {};
  for (let i = 0; i <= ceiling; i++) criteria[String(i)] = `The answer is exactly ${i}`;
  criteria[`over ${ceiling}`] = `The answer is greater than ${ceiling}`;
  criteria["not stated"] = "The text does not give this number";

  const res = await timed("api", () =>
    client.systemOne({
      state: { question, section, text },
      questions: { count: choice("How many, according to the text?", criteria) },
    }),
  );
  const a = res.answers.count as ChoiceResponse;
  return { text: a.choice, p: (a.probabilities as Record<string, number>)[a.choice] ?? a.confidence };
}

async function truthFrom(
  client: TypeSafeClient,
  question: string,
  section: string,
  text: string,
): Promise<Answer> {
  const res = await timed("api", () =>
    client.systemOne({
      state: { question, section, text },
      questions: {
        truth: noul("The statement in the question is true according to the text", {
          true: "The text states this, using the same name or term the statement uses",
          false:
            "The text does not state this, contradicts it, or only names something whose name merely contains " +
            "the term in the statement. A longer name is a different thing: 'fire bolt' is not 'bolt'.",
        }),
      },
    }),
  );
  const p = (res.answers.truth as NoulResponse).noul;
  return { text: p >= 0.5 ? "true" : "false", p: p >= 0.5 ? p : 1 - p };
}

export async function answerFrom(
  client: TypeSafeClient,
  kind: Kind,
  question: string,
  section: string,
  text: string,
  countMax: number,
): Promise<Answer | undefined> {
  if (kind === "count") return countFrom(client, question, section, text, countMax);
  if (kind === "truth") return truthFrom(client, question, section, text);
  return undefined;
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Crude singular, enough to match a question's "class" to a section's
 * "Classes". Only the first rule that applies fires: chaining them turns
 * "Classes" into "Class" and then into "Clas".
 */
function singular(word: string): string {
  for (const [re, to] of [[/ies$/, "y"], [/(ch|sh|ss|x)es$/, "$1"], [/s$/, ""]] as const) {
    if (re.test(word)) return word.replace(re, to);
  }
  return word;
}

/** Whether `phrase` appears in `text` as whole words, ignoring case and a leading "the". */
export function mentions(text: string, phrase: string): boolean {
  const p = normalize(phrase);
  if (!p) return false;
  return new RegExp(`(^| )${p.replace(/ /g, " ")}( |$)`).test(` ${normalize(text)} `);
}

/** Immediate children of each section, by the " > " path outline.js prints. */
export function childrenByParent(paths: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const path of paths) {
    const cut = path.lastIndexOf(" > ");
    if (cut < 0) continue;
    const parent = path.slice(0, cut);
    out.set(parent, [...(out.get(parent) ?? []), path.slice(cut + 3)]);
  }
  return out;
}

export type OutlineAnswer = { answer: Answer; parent: string };

/**
 * Decide a membership statement from the contents alone: "is witch a class?"
 * names a category ("class", matching the section "Classes") and an entry
 * ("Witch", listed under it). Both are string questions with exact answers, so
 * neither is asked of the model. jev picked the right section at p=0.56 and so
 * refused to commit, and every prose framing of the same question mistook a
 * leading article or an extra word for a different name.
 *
 * Undefined means the contents cannot settle it and the pages should be read.
 */
export function membershipFromContents(
  question: string,
  groups: [string, string[]][],
): { text: string; parent: string } | undefined {
  const category = groups.filter(([parent]) => {
    const leaf = parent.split(" > ").at(-1)!;
    return mentions(question, leaf) || mentions(question, singular(leaf));
  });
  if (category.length !== 1) return undefined;

  // The contents list a section's whole membership, the same assumption the
  // count path makes, so an entry absent from them is absent from the section.
  const [parent, kids] = category[0]!;
  return { text: kids.some((kid) => mentions(question, kid)) ? "true" : "false", parent };
}

/**
 * Answer from the table of contents alone, before opening the document. A book
 * that lists its nine classes as nine outline entries already holds the count;
 * reading the pages to recount them is slower and less exact.
 */
export async function answerFromOutline(
  client: TypeSafeClient,
  kind: Kind,
  question: string,
  paths: string[],
  floor: number,
): Promise<OutlineAnswer | undefined> {
  if (kind === "passage") return undefined;

  const groups = [...childrenByParent(paths)].filter(([, kids]) => kids.length > 1);
  if (groups.length === 0) return undefined;

  if (kind === "truth") {
    const m = membershipFromContents(question, groups);
    // Finding an entry in the contents proves it exists. Not finding one proves
    // nothing: contents summarize, and a section may list three of its four
    // classes. So a positive is taken as final and a negative is handed to the
    // page walk to confirm or overturn.
    return m?.text === "true" ? { answer: { text: "true", p: 1 }, parent: m.parent } : undefined;
  }

  // Option names are sent to the model, so they carry the section name; the
  // index keeps them unique when two parents end in the same word.
  const keyed = groups.map(([parent, kids], i) => ({ key: `${i}:${parent.split(" > ").at(-1)}`, parent, kids }));
  const criteria: Record<string, string> = Object.fromEntries(
    keyed.map(({ key, parent, kids }) => [
      key,
      `"${parent}" lists ${kids.length} entries: ${kids.join(", ")}`,
    ]),
  );
  criteria["none of these"] = "No section's entries are what the question is about";

  const picked = await timed("api", () =>
    client.systemOne({
      state: { question, sections: keyed.map((k) => ({ section: k.parent, entries: k.kids })) },
      questions: {
        group: choice("Which section's entries are the things the question is about?", criteria),
      },
    }),
  );
  const g = picked.answers.group as ChoiceResponse;
  if (g.choice === "none of these") return undefined;
  const hit = keyed.find((k) => k.key === g.choice);
  if (!hit) return undefined;

  const pGroup = (g.probabilities as Record<string, number>)[g.choice] ?? g.confidence;
  if (pGroup < floor) return undefined;

  const answer = { text: String(hit.kids.length), p: pGroup };
  return answer.p >= floor ? { answer, parent: hit.parent } : undefined;
}
