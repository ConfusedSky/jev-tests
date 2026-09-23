import { choice, noul, type TypeSafeClient } from "@typesafe-ai/sdk";
import { pageLines, paragraphs, styledCandidates, type Para } from "./layout";
import { timed } from "./shared";

export const KINDS = ["count", "number", "truth", "passage"] as const;
export type Kind = (typeof KINDS)[number];
/** The kinds that yield a value to be confident about; a passage is satisfied by the page itself. */
export type Valued = Exclude<Kind, "passage">;

export const STOPWORDS = new Set(
  (
    "a an the and or of for to in on at by with from as is are was were be been does do did has have had " +
    "what which who whom whose how much many when where why it its this that these those there their his her " +
    "my your our i you he she we they them me us can could would should will shall may might"
  ).split(" "),
);

/**
 * What jev reads off the question's wording alone, in one call: the shape of
 * answer wanted, the quantities a number question names, the kind of thing a
 * count question counts ("theme kits" in "how many theme kits") and the
 * subject whose entry is wanted ("combat rifle"), which the text search looks for.
 */
export type Reading = { kind: Kind; quantities: string[]; counted: string; subject: string[] };

type Word = { word: string; ends: boolean };

/** Adjacent words that passed form one name, and a comma ends a name. */
function namesFrom(words: Word[], passed: (i: number) => boolean): string[] {
  const names: string[] = [];
  let run: string[] = [];
  words.forEach((w, i) => {
    const yes = !STOPWORDS.has(w.word.toLowerCase()) && passed(i);
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
 * What shape of answer the question wants, which quantities it names ("the
 * cost, weight and damage rating of a combat rifle" names three), what kind
 * of thing it counts and what it is about. All come from the wording alone,
 * so they go out together, and the parts the kind does not need are ignored.
 *
 * A noul per word for each. Asked word by word the model lets "what" and
 * "of" through at p=0.5 or so; grammar words can never name a quantity or a
 * kind, and they end a name.
 */
export async function readQuestion(client: TypeSafeClient, question: string): Promise<Reading> {
  const words = question
    .split(/\s+/)
    .map((raw) => ({ word: raw.replace(/[^\w'-]/g, ""), ends: /[,;]$/.test(raw) }))
    .filter((w) => w.word);
  const kind = choice("What shape of answer does `question` want?", {
    count: "Asks how many of something there are: a tally of entries, items or options to be counted up",
    number: "Asks for a figure the text states outright: a cost, a weight, a rating, a distance, a limit, how much of something",
    truth: "States something that is either true or false, or asks whether something is the case",
    passage: "Asks what, how or why, and wants an explanation or the place it is written",
  });
  const perWord: Record<string, ReturnType<typeof noul>> = Object.fromEntries(
    words.flatMap((w, i) => [
      [
        `w${i}`,
        noul(
          `\`words[${i}]\` ("${w.word}") names the quantity whose value \`question\` asks for, such as a cost, weight, ` +
            'rating, range, duration or amount; "how much does it cost" asks for a cost. Not the thing measured, not a joining word.',
        ),
      ],
      [
        `k${i}`,
        noul(
          `\`words[${i}]\` ("${w.word}") is part of the name of the kind of thing \`question\` asks how many there are, ` +
            "such as perks, classes or theme kits. Not the owner of them, not a verb, not a joining word.",
        ),
      ],
      [
        `s${i}`,
        noul(
          `\`words[${i}]\` ("${w.word}") is part of the name of the thing \`question\` is about, whose entry, rule or ` +
            "values are wanted, such as combat rifle, equipment tags or perks. Not the quantity asked for, not a verb, not a joining word.",
        ),
      ],
    ]),
  );
  const res = await timed("api", () =>
    client.systemOne({ state: { question, words: words.map((w) => w.word) }, questions: { kind, ...perWord } }),
  );
  // The spread hides the per-word keys from the answer type.
  const perWordAnswers = res.answers as unknown as Record<string, { noul: number }>;
  const passed = (prefix: string) => (i: number) => perWordAnswers[`${prefix}${i}`]!.noul >= 0.5;
  return {
    kind: res.answers.kind.choice,
    quantities: namesFrom(words, passed("w")),
    // A count counts one kind of thing; the first name is it.
    counted: namesFrom(words, passed("k"))[0] ?? "",
    subject: namesFrom(words, passed("s")),
  };
}

/**
 * `pages` are where the answer was read when that is not the window that
 * passed: the pages a count counted anything on. `passage` is the answering
 * stretch of a page with its weights, for printing; `text` holds it plain.
 */
export type Answer = { text: string; p: number; pages?: number[]; passage?: Para[] };
/** A window's count with the names it counted, so a section counts each name once across its windows. */
type Counted = Answer & { names: string[] };

/** How an extracted answer bears on the walk: settle, keep as a fallback, or discard. */
export type Verdict = "take" | "keep" | "drop";
export type Judged = Answer & { verdict: Verdict };

/**
 * Every scrap of the text that could be the name of one entry: a line, a cell
 * of a table row or a column, or a phrase between commas and full stops, since
 * a rulebook lists its seven skills inline as often as one per line. A name
 * starts with a capital and is short; the prose fragments that survive that
 * cut still go to jev, which tells them from names, and the count is code's.
 */
export function cellsIn(text: string, maxLen = 60, maxWords = 4): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split("\n")) {
    // A list's first item hides behind its introduction: "The classes are the Cleaver, ...".
    for (const raw of line.split(/\s{3,}|[,;:.()]|\s(?:and|or|is|are|includes?|including|such as)\s/)) {
      // "the Cleaver, the Deadwalker": a name behind an article is still a name.
      const cell = raw.trim().replace(/^(?:the|a|an)\s+/i, "");
      if (!cell || cell.length > maxLen || !/^[A-Z]/.test(cell) || cell.split(/\s+/).length > maxWords) continue;
      const key = cell.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cell);
    }
  }
  return out;
}

// One request carries the text once per call, so cells travel in as few
// calls as the question budget allows.
const CELLS_PER_CALL = 150;

/**
 * "The Repair skill" and "REPAIR" are one skill: a name is compared without
 * its article and without the kind-word the question used, so a page that
 * headlines an entry and a page that mentions it count it once.
 */
export function nameKey(name: string, counted: string): string {
  const last = counted.split(/\s+/).at(-1)?.toLowerCase() ?? "";
  const bare = name.toLowerCase().replace(/^(?:the|a|an)\s+/, "").replace(/[\s.:,;]+$/, "");
  return last ? bare.replace(new RegExp(`\\s+(?:${singular(last)}|${last})$`), "") : bare;
}

// A cell at or above YES is counted. One at or above SURE is decided; one
// between DOUBT and SURE is where the count can be off by one either way.
const YES = 0.5;
const SURE = 0.7;
const DOUBT = 0.3;

/**
 * jev does not tally: it recognises the shape of a count, and the error grows
 * with the list. So the count is code's. The text's cells are the candidates,
 * one noul per cell asks whether it names an entry of the kind in question,
 * and the yeses are counted. Untimed; see countFrom.
 *
 * Each cell rides in its own question rather than in the state as a list:
 * shown the list, jev put "Survival" at 0.4 beside "Survival covers foraging
 * in" at 0.5; shown one entry at a time it puts them at 0.9 and 0.1. The kind
 * is named when the question names it: with "one of the things the question
 * asks about" the theme kits under each trope counted as tropes; with "one
 * trope" they did not.
 *
 * The count is as sure as the share of its cells that were decided clearly:
 * a page of 91 kits with 6 in doubt is a count, a page of 3 tropes with 16 in
 * doubt is not, and the least certain of 91 cells says little about either.
 */
/** Candidate names, each with the type style it is set in (none for a scrap), and the text they sit in. */
export type CountPart = { cells: { text: string; style: string }[]; text: string };

/**
 * Where a window's text is on a PDF, so a count can take its candidates from
 * the page's type: a book that styles its entries puts every name in a font
 * of its own and none of its prose, so the names come from the styled runs
 * and the prose never goes to jev. A page with no styled runs, the manual
 * fixture's inline "Athletics, Barter, …", falls back to the text's scraps.
 */
export type CountSource = { text: string; pdf?: string; page?: number; end?: number };

export async function countParts(src: CountSource): Promise<{ parts: CountPart[]; fallback?: CountPart[] }> {
  const scraps = [{ cells: cellsIn(src.text).map((text) => ({ text, style: "" })), text: src.text }];
  if (!src.pdf || src.page === undefined) return { parts: scraps };
  const pages = Array.from({ length: (src.end ?? src.page) - src.page + 1 }, (_, i) => src.page! + i);
  // The candidates come from the page's type; the text they are judged in
  // is the -layout text the walk read, a page per form feed, which keeps a
  // list's rows and columns where mutool's reading order put Legend in the
  // Mist's theme kits at 0.5 apiece.
  const layout = src.text.split("\f");
  const styled = await timed("extract", () =>
    Promise.all(
      pages.map(async (p, i) => {
        const page = await pageLines(src.pdf!, p);
        const text = layout[i]?.trim() ? layout[i]! : paragraphs(page, p).map((q) => q.text).join("\n\n");
        return { cells: styledCandidates(page, p), text };
      }),
    ),
  );
  // A title and a chapter heading are styled runs too; a page whose only
  // styled runs are those, and whose list is inline, is counted from scraps
  // when the runs count nothing.
  if (styled.reduce((n, p) => n + p.cells.length, 0) < 3) return { parts: scraps };
  return { parts: styled.filter((p) => p.cells.length > 0), fallback: scraps };
}

/** Counts from the source's candidates, and from its scraps when the styled runs count nothing. */
async function countSource(client: TypeSafeClient, question: string, section: string, src: CountSource, counted: string): Promise<Counted> {
  const { parts, fallback } = await countParts(src);
  const a = await rawCount(client, question, section, parts, counted);
  return a.names.length === 0 && fallback ? rawCount(client, question, section, fallback, counted) : a;
}

async function rawCount(client: TypeSafeClient, question: string, section: string, parts: CountPart[], counted: string): Promise<Counted> {
  const one = counted ? `one ${counted}` : "one of the things `question` asks how many there are";
  const asks = parts.flatMap((part) => part.cells.map((cell) => ({ cell: cell.text, style: cell.style, text: part.text })));
  if (asks.length === 0) return { text: "not stated", p: 1, names: [] };
  // One call per part, chunked; each cell rides in its own question with
  // its page's text in the state.
  const chunks: { text: string; idx: number[] }[] = [];
  for (const [t, group] of Map.groupBy(asks.map((_, i) => i), (i) => asks[i]!.text)) {
    for (let i = 0; i < group.length; i += CELLS_PER_CALL) chunks.push({ text: t, idx: group.slice(i, i + CELLS_PER_CALL) });
  }
  const ps = new Array<number>(asks.length);
  await Promise.all(
    chunks.map(async ({ text, idx }) => {
      const questions = Object.fromEntries(
        idx.map((i) => [
          `c${i}`,
          noul(
            {
              entry: asks[i]!.cell,
              ask: `\`entry\` is the name of ${one}: a single entry of the list \`question\` asks to count, as \`text\` lists or headlines it.`,
            },
            {
              true: `It is exactly the name of ${one} and nothing more`,
              false:
                "It is the name of the kind itself, a heading over a group of entries, an entry of another kind " +
                `(including a part, option or sub-entry listed under ${one}), a sentence or phrase about an entry, or a value`,
            },
          ),
        ]),
      );
      const res = await client.systemOne({ state: { question, section, text }, questions });
      for (const i of idx) ps[i] = (res.answers[`c${i}`] as { noul: number }).noul;
    }),
  );
  // A book sets every entry of a list in one style, so the yeses in the
  // style most of them share are the list, and a yes in another style is a
  // header over it or a stray: the theme kits' type headers, a "GUNS" off
  // an illustration beside the perks.
  const yes = asks.filter((_, i) => ps[i]! >= YES);
  const styles = new Map<string, number>();
  for (const a of yes) styles.set(a.style, (styles.get(a.style) ?? 0) + 1);
  const list = [...styles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const names = [...new Set(yes.filter((a) => a.style === list).map((a) => nameKey(a.cell, counted)))];
  if (names.length === 0) return { text: "not stated", p: 1, names };
  const sure = ps.filter((p) => p >= SURE).length;
  const doubt = ps.filter((p) => p >= DOUBT && p < SURE).length;
  return { text: String(names.length), p: sure / (sure + doubt), names };
}

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

// A value that recurs on several rows gets each row as its own option, up to
// this many; the model cannot pick a row it was never shown.
const ROWS_PER_VALUE = 3;

/**
 * Every figure the text states, digits or words, with a scrap of the text
 * around it. These are the only numbers a stated-figure question can be
 * answered with, so they are the choices offered. A figure repeated on one
 * line is one figure; repeated on another line it is another option, since
 * the "5" in a table's header row and the "5" in the Combat Rifle row are
 * told apart only by their rows.
 */
export function figuresIn(text: string, around = 60): Figure[] {
  const rows = new Map<string, number>();
  const out: Figure[] = [];
  // Line by line: with -layout a table row is a line, so a figure's context is
  // its row, label included, rather than whatever sat above and below it.
  for (const line of text.split("\n")) {
    const flat = line.replace(/\s+/g, " ").trim();
    const onLine = new Set<string>();
    for (const m of flat.matchAll(NUMBER)) {
      const raw = m[0];
      const value = /^\d/.test(raw) ? raw.replace(/,/g, "") : String(wordsToNumber(raw));
      if (onLine.has(value) || (rows.get(value) ?? 0) >= ROWS_PER_VALUE) continue;
      onLine.add(value);
      rows.set(value, (rows.get(value) ?? 0) + 1);
      const at = m.index!;
      const context = flat.slice(Math.max(0, at - around), Math.min(flat.length, at + raw.length + around)).trim();
      out.push({ value, context });
    }
  }
  return out;
}

// A Choice takes at most 255 options; one is spent on "not stated".
const FIGURE_LIMIT = 254;
// Jev takes 32k tokens for the state plus its longest question and 64k for the
// state plus every question, about four characters a token. Kept under both
// with room to spare, since the text is sent as well.
const LONGEST_CHARS = 100_000;
const TOTAL_CHARS = 200_000;

/** How many figures fit the request budget when `asked` choices each list them all. */
export function figureLimit(textLength: number, asked: number, around: number): number {
  const perOption = 2 * around + 40;
  const longest = Math.floor((LONGEST_CHARS - textLength) / perOption);
  const total = Math.floor((TOTAL_CHARS - textLength) / (asked * perOption));
  return Math.max(1, Math.min(FIGURE_LIMIT, longest, total));
}

/**
 * A stated figure is one of the numbers on the page, so those are the choices,
 * each shown with the words around it. A count never asks this: the total of
 * a list is not written anywhere on the page. A question naming several
 * quantities asks one choice per quantity, in one call, and answers
 * "cost 53, weight 4"; the confidence is the least certain part.
 */
async function numberFrom(
  client: TypeSafeClient,
  question: string,
  section: string,
  text: string,
  wanted: string[],
): Promise<Answer> {
  const asked = wanted.length > 0 ? wanted : [""];
  const around = 60;
  const figures = figuresIn(text, around).slice(0, figureLimit(text.length, asked.length, around));
  if (figures.length === 0) return { text: "not stated", p: 1 };
  // Option names are sent to the model and must be unique, so a value's
  // second row is "5 #2"; code maps the pick back to the value.
  const valueOf = new Map<string, string>();
  const rows = new Map<string, number>();
  const criteria: Record<string, string> = {};
  for (const f of figures) {
    const n = (rows.get(f.value) ?? 0) + 1;
    rows.set(f.value, n);
    const key = n === 1 ? f.value : `${f.value} #${n}`;
    valueOf.set(key, f.value);
    criteria[key] = `The answer is ${f.value}, as in: …${f.context}…`;
  }
  criteria["not stated"] = "None of these figures is it";
  const questions = Object.fromEntries(
    asked.map((name, i) => [
      `q${i}`,
      choice(
        name
          ? `Which figure from \`text\` is the ${name} that \`question\` asks for?`
          : "Which figure from `text` answers `question`?",
        criteria,
      ),
    ]),
  );
  const res = await timed("api", () => client.systemOne({ state: { question, section, text }, questions }));
  // A value on several rows splits its probability across their options;
  // the value's probability is their sum.
  const parts = asked.map((name, i) => {
    const a = res.answers[`q${i}`] as { choice: string; confidence: number; probabilities: Record<string, number> };
    const byValue = new Map<string, number>();
    for (const [key, prob] of Object.entries(a.probabilities)) {
      const v = valueOf.get(key) ?? key;
      byValue.set(v, (byValue.get(v) ?? 0) + prob);
    }
    const [text, p] = [...byValue.entries()].sort((x, y) => y[1] - x[1])[0] ?? [valueOf.get(a.choice) ?? a.choice, a.confidence];
    return { name, text, p };
  });
  if (parts.length === 1) return { text: parts[0]!.text, p: parts[0]!.p };
  const stated = parts.filter((x) => x.text !== "not stated");
  if (stated.length === 0) return { text: "not stated", p: Math.min(...parts.map((x) => x.p)) };
  return { text: parts.map((x) => `${x.name} ${x.text}`).join(", "), p: Math.min(...stated.map((x) => x.p)) };
}

/**
 * A list longer than one window cannot be counted in one call, so each window
 * is counted on its own and the parts are added up, each name once: the
 * Fallout skills page lists all seventeen and the three pages after it
 * headline each again, which summed to 34. A part below `floor` is no
 * information and is left out. The aggregate is as trustworthy as its least
 * certain counted part, scaled by the share of the section that was counted:
 * three sure pages out of thirty-six is not a count.
 */
export async function countAcross(
  client: TypeSafeClient,
  question: string,
  section: string,
  windows: (CountSource & { page: number })[],
  kind = "",
  floor = 0,
  onPart?: (page: number, part: Answer, counted: boolean, running: number) => void,
): Promise<Answer> {
  // One span for the parallel calls, so the timing split stays under wall time.
  const parts = await timed("api", () => Promise.all(windows.map((w) => countSource(client, question, section, w, kind))));
  const seen = new Set<string>();
  let worst = 1;
  let covered = 0;
  const pages: number[] = [];
  for (const [i, part] of parts.entries()) {
    const { names, ...answer } = part;
    const counted = part.p >= floor;
    if (counted) covered++;
    // "not stated" carries no number to add; a window listing none is
    // expected in a long section, so it lowers no confidence.
    if (counted && names.length > 0) {
      for (const name of names) seen.add(name);
      pages.push(windows[i]!.page);
      worst = Math.min(worst, part.p);
    }
    onPart?.(windows[i]!.page, answer, counted, seen.size);
  }
  return pages.length === 0 ? { text: "not stated", p: 1 } : { text: String(seen.size), p: worst * (covered / windows.length), pages };
}

/**
 * Whether a page names the thing a membership claim is about, as a whole
 * cell of its own: "Vermissian Knight" does not name "knight". A claim not
 * shaped as membership names nothing, and the page's list noul decides.
 */
function named(text: string, question: string): boolean {
  const subject = /^(?:is )?(?:the )?(.+?)(?: is)? (?:a|an|one of the) /.exec(normalize(question))?.[1];
  if (!subject) return false;
  return cellsIn(text, 80, 6).some((cell) => normalize(cell) === subject);
}

/**
 * Whether the text states the claim, contradicts it, or lists its kind
 * without it are three judgments, so they are three nouls in one call.
 * Silence is none of them: a page that does not speak to the claim is "not
 * stated" and the walk goes on, rather than a confident false read off the
 * wrong page. The kind is named in each, since the classes page put
 * "Is heretic a calling?" at 0.5 stated until the question said a calling is
 * not a class.
 */
/**
 * The three nouls a statement is judged by, over `of` (a state path such as
 * `text` or `pages.p12`): stated, contradicted, and lists the kind. The walk
 * gates a page on the same three, so a page that passes has its answer.
 */
export function claimNouls(of: string): ReturnType<typeof noul>[] {
  return [
    // The whole-name clause sits in the instruction, not only the false
    // criterion: with it there alone, "Is knight a class?" was stated at
    // 0.40 beside "Vermissian Knight"; with it here, 0.09.
    noul(
      `${of} states the claim made in \`question\`: the exact, whole name the claim gives, no longer and no shorter, ` +
        "is named there as one of the kind-word (class, perk, calling, spell) the claim uses",
      {
        true: "That exact whole name is there, as that kind",
        false:
          `${of} does not say this, says it of another kind, or only has a longer name that contains the claim's name as a part: ` +
          "'Vermissian Knight' is not 'knight', 'fire bolt' is not 'bolt'.",
      },
    ),
    noul(`${of} contradicts the claim made in \`question\``, {
      true: `${of} says otherwise`,
      false: `${of} agrees with the claim, or does not speak to it at all`,
    }),
    // Whether the page lists things of that kind is the model's; whether
    // the exact name is among them is a string comparison, code's.
    noul(`${of} lists or headlines things called by the same kind-word \`question\` uses (a class, a perk, a calling)`, {
      true: "Things of exactly that kind are listed or headlined there",
      false: `No list of things of that kind, whatever other kinds ${of} lists`,
    }),
  ];
}

/** The verdict on a statement from its three nouls over `text`, in the order claimNouls gives them. */
export function claimVerdict(question: string, text: string, [s, c, kind]: number[]): Answer {
  const a = named(text, question) ? 0 : kind!;
  if (s! >= 0.5 && s! >= c!) return { text: "true", p: s! };
  // A false is as sure as the contradiction or the list without the name.
  // Folding in 1 - stated read 0.96 off a page that never mentioned the
  // claim once its list noul crossed 0.5, and one noul's complement is not
  // another noul's probability.
  if (c! >= 0.5 || a >= 0.5) return { text: "false", p: Math.max(c!, a) };
  return { text: "not stated", p: 1 - Math.max(s!, c!, a) };
}

async function truthFrom(client: TypeSafeClient, question: string, section: string, text: string): Promise<Answer> {
  const questions = Object.fromEntries(claimNouls("`text`").map((q, i) => [`c${i}`, q]));
  const res = await timed("api", () => client.systemOne({ state: { question, section, text }, questions }));
  return claimVerdict(question, text, [0, 1, 2].map((i) => (res.answers[`c${i}`] as { noul: number }).noul));
}

/** `read` supplies what the question named: the quantities a number wants, the kind a count counts. */
export async function answerFrom(
  client: TypeSafeClient,
  kind: Valued,
  question: string,
  section: string,
  text: string,
  read: Partial<Pick<Reading, "quantities" | "counted">> = {},
  at: Omit<CountSource, "text"> = {},
): Promise<Answer> {
  if (kind === "count") {
    const { names: _, ...a } = await timed("api", () => countSource(client, question, section, { text, ...at }, read.counted ?? ""));
    return a;
  }
  if (kind === "number") return numberFrom(client, question, section, text, read.quantities ?? []);
  return truthFrom(client, question, section, text);
}

// A sentence counts for a passage by how far it sits above this; the run
// summing highest is the passage. The bar is above even odds because a
// column's spillover on the Legend in the Mist creation page sat at 0.6 and
// would have trailed the passage at 0.5, while a heading's 0.43 dip inside
// the Fallout RadAway entry is outweighed by the sentences around it.
const PASSAGE_BAR = 0.65;

/** The run of `ps` with the largest total above `bar`, or none when no run rises above it. */
export function bestRun(ps: number[], bar = PASSAGE_BAR): { start: number; end: number } | undefined {
  let best: { start: number; end: number; sum: number } | undefined;
  let start = 0;
  let sum = 0;
  ps.forEach((p, i) => {
    if (sum <= 0) {
      start = i;
      sum = 0;
    }
    sum += p - bar;
    if (sum > 0 && (!best || sum > best.sum)) best = { start, end: i + 1, sum };
  });
  return best && { start: best.start, end: best.end };
}

/** A sentence of a paragraph, with its weights and its place in the paragraph, as one unit a passage can start or end on. */
type Unit = { para: number; text: string; style: string; start: number; end: number };

/** The sentences of each paragraph; a heading is one sentence. */
export function unitsOf(paras: Para[]): Unit[] {
  const out: Unit[] = [];
  paras.forEach((p, i) => {
    if (p.heading) {
      out.push({ para: i, text: p.text, style: p.style, start: 0, end: p.text.length });
      return;
    }
    let at = 0;
    const cut = (end: number) => out.push({ para: i, text: p.text.slice(at, end), style: p.style.slice(at, end), start: at, end });
    for (const m of p.text.matchAll(/(?<=[.!?])\s+(?=[^a-z])/g)) {
      cut(m.index!);
      at = m.index! + m[0].length;
    }
    cut(p.text.length);
  });
  return out.filter((u) => u.text.length > 1);
}

/**
 * The stretch of a page that answers a passage question: one noul per
 * sentence asks whether it is part of the answer, and the run summing
 * highest above the bar is the passage, as sure as its sentences are on
 * average. Each sentence rides in its own question with the page in the
 * state: as a numbered list in the state instead, the sentence "RadAway is
 * stocked in the vault clinic" sat at 0.47 for "How is radiation treated?",
 * and a whole Fallout chems page between 0.4 and 0.7.
 */
/** Pages a passage may grow onto past the window it was found in, each way. */
const PASSAGE_REACH = 2;

export async function readPassage(
  client: TypeSafeClient,
  question: string,
  section: string,
  paras: Para[],
  more?: (dir: "before" | "after") => Promise<Para[]>,
): Promise<Answer> {
  let units = unitsOf(paras);
  if (units.length === 0) return { text: "not stated", p: 1 };
  /** Whether each of `units` (a slice of the whole) is part of the answer, with the whole text in the state. */
  const judge = async (us: Unit[], text: string): Promise<number[]> => {
    const chunks: Unit[][] = [];
    for (let i = 0; i < us.length; i += CELLS_PER_CALL) chunks.push(us.slice(i, i + CELLS_PER_CALL));
    const ps = await timed("api", () =>
      Promise.all(
        chunks.map(async (chunk) => {
          const questions = Object.fromEntries(
            chunk.map((u, i) => [
              `s${i}`,
              noul(
                { sentence: u.text, ask: "`sentence` is part of the answer to `question`" },
                {
                  true: "It states, explains or lists something `question` asks for, or is the heading or lead-in of the passage that does",
                  false: "It is about something else, or merely sits near the answer",
                },
              ),
            ]),
          );
          const res = await client.systemOne({ state: { question, section, text }, questions });
          return chunk.map((_, i) => (res.answers[`s${i}`] as { noul: number }).noul);
        }),
      ),
    );
    return ps.flat();
  };
  const whole = () => paras.map((p) => p.text).join("\n\n");
  let ps = await judge(units, whole());
  let run = bestRun(ps);
  // A passage that reaches the window's edge goes on past it: the phases of
  // a round start at the foot of one page and end on the next. Only the new
  // page's sentences are asked; a page's units do not change by its neighbours.
  for (const [dir, edge] of [["after", () => run!.end === units.length], ["before", () => run!.start === 0]] as const) {
    for (let reach = 0; run && edge() && more && reach < PASSAGE_REACH; reach++) {
      const next = await more(dir);
      if (next.length === 0) break;
      const fresh = unitsOf(next);
      if (dir === "after") {
        paras = [...paras, ...next];
        units = [...units, ...fresh.map((u) => ({ ...u, para: u.para + paras.length - next.length }))];
        ps = [...ps, ...(await judge(fresh, whole()))];
      } else {
        paras = [...next, ...paras];
        units = [...fresh, ...units.map((u) => ({ ...u, para: u.para + next.length }))];
        ps = [...(await judge(fresh, whole())), ...ps];
      }
      run = bestRun(ps);
    }
  }
  if (!run) return { text: "not stated", p: 1 };
  const chosen = ps.slice(run.start, run.end);
  // Sentences of one paragraph go back together, with the lines they sit
  // on for highlighting; a heading keeps its own line.
  const passage: (Para & { para: number })[] = [];
  for (const u of units.slice(run.start, run.end)) {
    const last = passage.at(-1);
    const lines = paras[u.para]!.lines.filter((l) => l.end > u.start && l.start < u.end);
    if (last && last.para === u.para) {
      last.text += ` ${u.text}`;
      last.style += ` ${u.style}`;
      for (const l of lines) if (!last.lines.includes(l)) last.lines.push(l);
    } else passage.push({ para: u.para, heading: paras[u.para]!.heading, text: u.text, style: u.style, lines });
  }
  return {
    text: passage.map((p) => p.text).join("\n"),
    p: chosen.reduce((a, b) => a + b, 0) / chosen.length,
    // A window of several pages links to the page the passage starts on.
    pages: [...new Set(passage.flatMap((p) => p.lines.map((l) => l.page)))],
    passage: passage.map(({ heading, text, style, lines }) => ({ heading, text, style, lines })),
  };
}

export const normalize = (s: string) =>
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
export function singular(word: string): string {
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
  counted = "",
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
  // A Choice takes at most 255 options; one is spent on "none of these".
  const keyed = groups.slice(0, 254).map(([parent, kids], i) => ({ key: `${i}:${parent.split(" > ").at(-1)}`, parent, kids }));
  const criteria: Record<string, string> = Object.fromEntries(
    keyed.map(({ key, parent, kids }, i) => [key, `"${parent}" lists the ${kids.length} entries in \`sections[${i}].entries\``]),
  );
  criteria["none of these"] = "No section's entries are what the question is about";

  // Asked alongside the pick, for whichever section it lands on: the
  // Cyberpunk Red skill list bookmarks its nine groups of skills, "Awareness
  // Skills" and so on, and nine was the answer until the entries were
  // checked for being the things themselves rather than kinds of them.
  const things = counted || "the things `question` asks how many there are";
  const grouped = Object.fromEntries(
    keyed.map((k, i) => [
      `g${i}`,
      noul(`\`sections[${i}].entries\` are groups, categories or kinds of ${things}, each holding several, rather than ${things} themselves, one each`, {
        true: "Each entry names a group of them",
        false: "Each entry is one of them",
      }),
    ]),
  );
  const picked = await timed("api", () =>
    client.systemOne({
      state: { question, sections: keyed.map((k) => ({ section: k.parent, entries: k.kids })) },
      questions: {
        group: choice("Which of `sections` has as its entries the things `question` asks how many there are?", criteria),
        ...grouped,
      },
    }),
  );
  const g = picked.answers.group;
  const hit = keyed.find((k) => k.key === g.choice);
  if (!hit) return undefined;

  const p = g.probabilities[g.choice] ?? g.confidence;
  if (p < floor) return undefined;
  const groupsOfThem = (picked.answers as unknown as Record<string, { noul: number } | undefined>)[`g${keyed.indexOf(hit)}`]?.noul ?? 0;
  if (groupsOfThem >= 0.5) return { parent: hit.parent };

  // Counting bookmarks only works while they are the list. The Fallout
  // rulebook nests 89 of its 94 perks under the first perk, so the perks
  // section lists one perk and six statistics; an entry with more entries
  // under it than its parent has is where the list went. Read the pages
  // instead. A long span alone proves nothing: Heart gives each of its five
  // callings two pages, and five is still the count.
  const swallowed = hit.kids.some((kid) => (children.get(`${hit.parent} > ${kid}`)?.length ?? 0) > hit.kids.length);
  if (swallowed) return { parent: hit.parent };
  // Or jev picked that entry itself: "Aquaboy/Aquagirl" listing 89 perks is
  // the perks section's list, and the section is what the pages should cover.
  // Its siblings are leaves, statistics parked beside it. A list under a
  // small parent looks the same by counts alone, Heart's nine classes beside
  // its five callings, but there the sibling has children of its own.
  // And the section above must be the one about the kind counted, "Step 4:
  // Choose Your First Perk" for perks, else a Classes list beside two
  // childless sections would send the whole Characters chapter to the pages.
  const above = hit.parent.slice(0, Math.max(0, hit.parent.lastIndexOf(" > ")));
  const siblings = (children.get(above) ?? []).filter((s) => `${above} > ${s}` !== hit.parent);
  const leaves = siblings.every((s) => !children.has(`${above} > ${s}`));
  const kindWord = counted.split(/\s+/).at(-1) ?? "";
  const aboutKind = !kindWord || [kindWord, singular(kindWord)].some((w) => mentions(above.split(" > ").at(-1)!, w));
  if (siblings.length > 0 && siblings.length < hit.kids.length && leaves && aboutKind) return { parent: above };

  return { answer: { text: String(hit.kids.length), p }, parent: hit.parent };
}
