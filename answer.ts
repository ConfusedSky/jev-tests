import { choice, noul, type TypeSafeClient } from "@typesafe-ai/sdk";
import { timed } from "./shared";

export const KINDS = ["count", "number", "truth", "passage"] as const;
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
          count: "Asks how many of something there are: a tally of entries, items or options to be counted up",
          number: "Asks for a figure the text states outright: a cost, a weight, a rating, a distance, a limit, how much of something",
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

/** Jev writes no prose, so a count is a choice over the numbers themselves. Untimed; see countFrom. */
async function rawCount(
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

    const res = await client.systemOne({
      state: { question, section, text },
      questions: {
        count: choice(
          partial
            ? "How many does THIS part of the text list? Count only entries that appear here, not the total the document may have elsewhere."
            : "How many, according to the text?",
          criteria,
        ),
      },
    });
    const a = res.answers.count;
    return { text: a.choice, p: a.probabilities[a.choice] ?? a.confidence };
  };

  const ceiling = Math.min(max, COUNT_CEILING);
  const a = await ask(ceiling);
  // "over N" is a real answer, but a low --count-max should not be the reason
  // for it: one more call with the full range usually pins the number down.
  return a.text === `over ${ceiling}` && ceiling < COUNT_CEILING ? ask(COUNT_CEILING) : a;
}

const countFrom = (client: TypeSafeClient, question: string, section: string, text: string, max: number) =>
  timed("api", () => rawCount(client, question, section, text, max));

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};
const SCALE: Record<string, number> = { hundred: 100, thousand: 1000, million: 1000000 };
const WORDS = `(?:${[...Object.keys(SMALL), ...Object.keys(SCALE)].join("|")})`;
// A figure may carry a unit on its tail ("5CD", "10mm") but never a letter on
// its head: "v2.5", "p12" and "Mk3" are names, not figures.
const NUMBER = new RegExp(
  `(?<![\\w.])\\d[\\d,]*(?:\\.\\d+)?|\\b${WORDS}(?:[ -](?:and[ -])?${WORDS})*\\b`,
  "gi",
);

/** "two hundred" is 200; "twenty-one" is 21. */
function wordsToNumber(s: string): number {
  let total = 0;
  let run = 0;
  for (const w of s.toLowerCase().split(/[ -]+/)) {
    if (w === "and") continue;
    if (w in SMALL) run += SMALL[w]!;
    else if (w in SCALE) {
      run = (run || 1) * SCALE[w]!;
      if (SCALE[w]! >= 1000) {
        total += run;
        run = 0;
      }
    }
  }
  return total + run;
}

export type Figure = { value: string; context: string };

/**
 * Every figure the text states, digits or words, with a scrap of the text
 * around its first appearance. These are the only numbers a stated-figure
 * question can be answered with, so they are the choices offered.
 */
export function figuresIn(text: string, around = 60): Figure[] {
  const seen = new Map<string, Figure>();
  // Line by line: with -layout a table row is a line, so a figure's context is
  // its row, label included, rather than whatever sat above and below it.
  for (const line of text.split("\n")) {
    const flat = line.replace(/\s+/g, " ").trim();
    for (const m of flat.matchAll(NUMBER)) {
      const raw = m[0];
      const value = /^\d/.test(raw) ? raw.replace(/,/g, "") : String(wordsToNumber(raw));
      if (seen.has(value)) continue;
      const at = m.index!;
      const context = flat.slice(Math.max(0, at - around), Math.min(flat.length, at + raw.length + around)).trim();
      seen.set(value, { value, context });
    }
  }
  return [...seen.values()];
}

// A Choice takes at most 255 options; one is spent on "not stated".
const FIGURE_LIMIT = 254;

const STOPWORDS = new Set(
  (
    "a an the and or of for to in on at by with from as is are was were be been does do did has have had " +
    "what which who whom whose how much many when where why it its this that these those there their his her " +
    "my your our i you he she we they them me us can could would should will shall may might"
  ).split(" "),
);

/**
 * The quantities a question asks the value of: "the cost, weight and damage
 * rating of a combat rifle" names three. One call, a noul per word; adjacent
 * words that pass form one name, and a comma ends a name. Decided once per
 * question, not per page.
 */
export async function quantitiesOf(client: TypeSafeClient, question: string): Promise<string[]> {
  const words = question
    .split(/\s+/)
    .map((raw) => ({ word: raw.replace(/[^\w'-]/g, ""), ends: /[,;]$/.test(raw) }))
    .filter((w) => w.word);
  if (words.length === 0) return [];
  // Asked word by word the model lets "what" and "of" through at p=0.5 or so;
  // grammar words can never name a quantity, and they end a name.
  const grammar = (w: string) => STOPWORDS.has(w.toLowerCase());
  const questions = Object.fromEntries(
    words.map((w, i) => [
      `w${i}`,
      noul(
        `The word "${w.word}" names a quantity whose value the question asks for, ` +
          "such as a cost, weight, rating, range, duration or amount. Not the thing measured, not a verb, not a joining word.",
      ),
    ]),
  );
  const res = await timed("api", () => client.systemOne({ state: { question }, questions }));
  const names: string[] = [];
  let run: string[] = [];
  words.forEach((w, i) => {
    const yes = !grammar(w.word) && res.answers[`w${i}`]!.noul >= 0.5;
    if (yes) run.push(w.word);
    if ((!yes || w.ends) && run.length) {
      names.push(run.join(" "));
      run = [];
    }
  });
  if (run.length) names.push(run.join(" "));
  return names;
}

/**
 * A stated figure is one of the numbers on the page, so those are the choices,
 * each shown with the words around it. A count offers 0 through N instead
 * because the total of a list is not written anywhere on the page. A question
 * naming several quantities asks one choice per quantity, in one call, and
 * answers "cost 53, weight 4"; the confidence is the least certain part.
 */
async function numberFrom(
  client: TypeSafeClient,
  question: string,
  section: string,
  text: string,
  wanted: string[],
): Promise<Answer> {
  const figures = figuresIn(text).slice(0, FIGURE_LIMIT);
  if (figures.length === 0) return { text: "not stated", p: 1 };
  const criteria: Record<string, string> = Object.fromEntries(
    figures.map((f) => [f.value, `The answer is ${f.value}, as in: …${f.context}…`]),
  );
  criteria["not stated"] = "None of these figures is it";
  const asked = wanted.length > 0 ? wanted : [""];
  const questions = Object.fromEntries(
    asked.map((name, i) => [
      `q${i}`,
      choice(name ? `Which figure from the text is the ${name} the question asks for?` : "Which figure from the text answers the question?", criteria),
    ]),
  );
  const res = await timed("api", () => client.systemOne({ state: { question, section, text }, questions }));
  const parts = asked.map((name, i) => {
    const a = res.answers[`q${i}`]!;
    return { name, text: a.choice, p: a.probabilities[a.choice] ?? a.confidence };
  });
  if (parts.length === 1) return { text: parts[0]!.text, p: parts[0]!.p };
  const stated = parts.filter((x) => x.text !== "not stated");
  if (stated.length === 0) return { text: "not stated", p: Math.min(...parts.map((x) => x.p)) };
  return { text: parts.map((x) => `${x.name} ${x.text}`).join(", "), p: Math.min(...stated.map((x) => x.p)) };
}

/**
 * A list longer than one window cannot be counted in one call, so each window
 * is counted on its own and the parts are added up. A part below `floor` is
 * no information and is left out: a page of prose next to the list came back
 * as 37 at p=0.04 and turned five callings into 102. The aggregate is as
 * trustworthy as its least certain counted part, scaled by the share of the
 * section that was counted: three sure pages out of thirty-six is not a count.
 */
export async function countAcross(
  client: TypeSafeClient,
  question: string,
  section: string,
  windows: { page: number; text: string }[],
  max: number,
  floor = 0,
  onPart?: (page: number, part: Answer, counted: boolean, running: number) => void,
): Promise<Answer> {
  // One span for the parallel calls, so the timing split stays under wall time.
  const parts = await timed("api", () =>
    Promise.all(windows.map((w) => rawCount(client, question, section, w.text, max, true))),
  );
  let total = 0;
  let worst = 1;
  let covered = 0;
  let any = false;
  for (const [i, part] of parts.entries()) {
    const n = Number(part.text);
    const counted = part.p >= floor;
    if (counted) covered++;
    // "not stated" and "over N" carry no number to add; a window listing none
    // is expected in a long section, so it lowers no confidence.
    if (counted && Number.isFinite(n)) {
      total += n;
      any = true;
      if (n > 0) worst = Math.min(worst, part.p);
    }
    onPart?.(windows[i]!.page, part, counted, total);
  }
  return any ? { text: String(total), p: worst * (covered / windows.length) } : { text: "not stated", p: 1 };
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
  wanted: string[] = [],
): Promise<Answer> {
  if (kind === "count") return countFrom(client, question, section, text, countMax);
  if (kind === "number") return numberFrom(client, question, section, text, wanted);
  return truthFrom(client, question, section, text);
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
): Promise<OutlineAnswer | undefined> {
  const paths = sections.map((s) => s.path);
  // A stated figure is on a page, never in the contents.
  if (kind === "passage" || kind === "number") return undefined;

  const children = childrenByParent(paths);
  const groups = [...children].filter(([, kids]) => kids.length > 1);
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

  // Counting bookmarks only works while they are the list. The Fallout
  // rulebook nests 89 of its 94 perks under the first perk, so the perks
  // section lists one perk and six statistics; an entry with more entries
  // under it than its parent has is where the list went. Read the pages
  // instead. A long span alone proves nothing: Heart gives each of its five
  // callings two pages, and five is still the count.
  if (!sections.some((s) => s.path === hit.parent)) return undefined;
  const swallowed = hit.kids.some((kid) => (children.get(`${hit.parent} > ${kid}`)?.length ?? 0) > hit.kids.length);
  if (swallowed) return { parent: hit.parent };

  return { answer: { text: String(hit.kids.length), p }, parent: hit.parent };
}
