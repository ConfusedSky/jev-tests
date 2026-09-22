import { choice, noul, type TypeSafeClient } from "@typesafe-ai/sdk";
import { timed } from "./shared";

export const KINDS = ["count", "truth", "passage"] as const;
export type Kind = (typeof KINDS)[number];
/** The kinds that yield a value to be confident about; a passage is satisfied by the page itself. */
export type Valued = Exclude<Kind, "passage">;

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
  return res.answers.kind.choice;
}

export type Answer = { text: string; p: number };

/** How an extracted answer bears on the walk: settle, keep as a fallback, or discard. */
export type Verdict = "take" | "keep" | "drop";
export type Judged = Answer & { verdict: Verdict };

// A Choice takes at most 255 options: 0 through 252, plus the two escapes.
const COUNT_CEILING = 252;

/** Jev writes no prose, so a count is a choice over the numbers themselves. */
async function countFrom(
  client: TypeSafeClient,
  question: string,
  section: string,
  text: string,
  max: number,
  partial = false,
): Promise<Answer> {
  const ask = async (ceiling: number): Promise<Answer> => {
    const criteria: Record<string, string> = {};
    for (let i = 0; i <= ceiling; i++) criteria[String(i)] = `The answer is exactly ${i}`;
    criteria[`over ${ceiling}`] = `The answer is greater than ${ceiling}`;
    criteria["not stated"] = partial
      ? "This part of the text lists none of them"
      : "The text does not give this number";

    const res = await timed("api", () =>
      client.systemOne({
        state: { question, section, text },
        questions: {
          count: choice(
            partial
              ? "How many does THIS part of the text list? Count only entries that appear here, not the total the document may have elsewhere."
              : "How many, according to the text?",
            criteria,
          ),
        },
      }),
    );
    const a = res.answers.count;
    return { text: a.choice, p: a.probabilities[a.choice] ?? a.confidence };
  };

  const ceiling = Math.min(max, COUNT_CEILING);
  const a = await ask(ceiling);
  // "over N" is a real answer, but a low --count-max should not be the reason
  // for it: one more call with the full range usually pins the number down.
  return a.text === `over ${ceiling}` && ceiling < COUNT_CEILING ? ask(COUNT_CEILING) : a;
}

/**
 * A list longer than one window cannot be counted in one call, so each window
 * is counted on its own and the parts are added up. The aggregate is only as
 * trustworthy as its least certain part, so that is the confidence reported.
 */
export async function countAcross(
  client: TypeSafeClient,
  question: string,
  section: string,
  windows: { page: number; text: string }[],
  max: number,
  onPart?: (page: number, part: Answer, running: number) => void,
): Promise<Answer> {
  let total = 0;
  let worst = 1;
  for (const w of windows) {
    const part = await countFrom(client, question, section, w.text, max, true);
    const n = Number(part.text);
    // "not stated" and "over N" carry no number to add; a window listing none
    // is expected in a long section, so it lowers no confidence.
    if (Number.isFinite(n)) {
      total += n;
      if (n > 0) worst = Math.min(worst, part.p);
    }
    onPart?.(w.page, part, total);
  }
  return { text: String(total), p: worst };
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
  const p = res.answers.truth.noul;
  return { text: p >= 0.5 ? "true" : "false", p: p >= 0.5 ? p : 1 - p };
}

export function answerFrom(
  client: TypeSafeClient,
  kind: Valued,
  question: string,
  section: string,
  text: string,
  countMax: number,
): Promise<Answer> {
  return kind === "count"
    ? countFrom(client, question, section, text, countMax)
    : truthFrom(client, question, section, text);
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
  return p !== "" && ` ${normalize(text)} `.includes(` ${p} `);
}

/**
 * The thing a membership statement is about: "witch" in "is witch a class?",
 * "witch is a class" or "is witch one of the classes?". Undefined when the
 * statement is not shaped like that.
 */
export function subjectOf(question: string, category: string): string | undefined {
  const m = new RegExp(`^(?:is )?(?:the )?(.+?)(?: is)? (?:a|an|one of the) ${normalize(category)}(?: |$)`).exec(
    normalize(question),
  );
  return m?.[1];
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

/**
 * What the contents say: an answer, or only which section the pages should
 * be read from when they cannot settle it.
 */
export type OutlineAnswer = { parent: string; answer?: Answer };

/**
 * Decide a membership statement from the contents alone: "is witch a class?"
 * names a category ("class", matching the section "Classes") and an entry
 * ("Witch", listed under it). Both are string questions with exact answers, so
 * neither is asked of the model. jev picked the right section at p=0.56 and so
 * refused to commit, and every prose framing of the same question mistook a
 * leading article or an extra word for a different name.
 *
 * The subject must equal an entry, not merely contain one: "witch hunter" is
 * not "witch", any more than "knight" is "vermissian knight".
 *
 * Undefined means no single section is the category asked about.
 */
export function membershipFromContents(
  question: string,
  groups: [string, string[]][],
): { text: string; parent: string } | undefined {
  const category = groups.flatMap(([parent, kids]) => {
    const leaf = parent.split(" > ").at(-1)!;
    const name = [leaf, singular(leaf)].find((n) => mentions(question, n));
    return name === undefined ? [] : [{ parent, kids, name }];
  });
  if (category.length !== 1) return undefined;

  // The contents list a section's whole membership, the same assumption the
  // count path makes, so an entry absent from them is absent from the section.
  const { parent, kids, name } = category[0]!;
  const subject = subjectOf(question, name);
  const listed = subject !== undefined && kids.some((kid) => normalize(kid) === subject);
  return { text: listed ? "true" : "false", parent };
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
  sections: { path: string; start: number; end: number }[],
  floor: number,
  maxSpan: number,
): Promise<OutlineAnswer | undefined> {
  const paths = sections.map((s) => s.path);
  if (kind === "passage") return undefined;

  const groups = [...childrenByParent(paths)].filter(([, kids]) => kids.length > 1);
  if (groups.length === 0) return undefined;

  if (kind === "truth") {
    const m = membershipFromContents(question, groups);
    if (!m) return undefined;
    // Finding an entry in the contents proves it exists. Not finding one proves
    // nothing: contents summarize, and a section may list three of its four
    // classes. So a positive is taken as final and a negative is handed to the
    // pages of that section, which are the ones that can overturn it: a
    // statement about callings read off the classes page came back true.
    return m.text === "true" ? { answer: { text: "true", p: 1 }, parent: m.parent } : { parent: m.parent };
  }

  // Option names are sent to the model, so they carry the section name; the
  // index keeps them unique when two parents end in the same word.
  const keyed = groups.map(([parent, kids], i) => ({ key: `${i}:${parent.split(" > ").at(-1)}`, parent, kids }));
  const criteria: Record<string, string> = Object.fromEntries(
    keyed.map(({ key, parent, kids }) => [key, `"${parent}" lists ${kids.length} entries: ${kids.join(", ")}`]),
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
  const g = picked.answers.group;
  const hit = keyed.find((k) => k.key === g.choice);
  if (!hit) return undefined;

  const p = g.probabilities[g.choice] ?? g.confidence;
  if (p < floor) return undefined;

  // Counting bookmarks only works while they are a list rather than a set of
  // chapters, and a long span is where that stops being true: the Fallout
  // rulebook nests 89 of its 94 perks under the first perk, so counting the
  // entries of any one section there is wrong. Read that section's pages instead.
  const at = sections.find((s) => s.path === hit.parent);
  if (!at) return undefined;
  if (at.end - at.start + 1 > maxSpan) return { parent: hit.parent };

  return { answer: { text: String(hit.kids.length), p }, parent: hit.parent };
}
