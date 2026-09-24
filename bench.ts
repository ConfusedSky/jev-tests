#!/usr/bin/env bun
/**
 * The shelf benchmark: every case worked through on real rulebooks, run
 * through the same layers the CLI uses, scored against the true answer and
 * compared with the last recorded run, so a change to a prompt or the walk
 * shows as a number moving rather than a test flipping. Truth is what the
 * book says; some cases are known to come out wrong and stay in the table
 * so the gap is visible. The books are named in .env and a case whose book
 * is missing is skipped.
 *
 *   bun bench.ts            run every case, print the table, write bench/latest.json
 *   bun bench.ts heart      only cases whose book or question matches
 *   bun bench.ts --no-save  compare with the last run without replacing it
 *   bun bench.ts --no-search  titles only, to see what the text search adds
 */
import { answerLayer, readDefaults, type ReadOpts } from "./cli";
import { makeUi, searchPdf, type Outcome } from "./pdf";
import { DEFAULT_MODEL, makeClient } from "./shared";

type Case = {
  book: "heart" | "fallout" | "litm" | "cpr";
  question: string;
  /** A count's true number, a statement's truth, a figure question's true answer text. */
  truth: number | string;
  /** Strings a passage must contain, in this order. */
  contains?: string[];
  /** Strings a passage must not contain. */
  without?: string[];
  page?: number;
  opts?: Partial<ReadOpts>;
  /** Why this is expected to come out wrong today. */
  known?: string;
};

const BOOKS = { heart: "JEV_HEART_PDF", fallout: "JEV_FALLOUT_PDF", litm: "JEV_LITM_PDF", cpr: "JEV_CPR_PDF" } as const;

const CASES: Case[] = [
  { book: "heart", question: "How many classes are there in heart?", truth: 9, page: 31 },
  { book: "heart", question: "How many callings are there in heart?", truth: 5, page: 21 },
  { book: "heart", question: "how many skills are there in heart?", truth: 9, page: 12 },
  { book: "heart", question: "how many domains are there in heart?", truth: 8, page: 12 },
  { book: "heart", question: "Is witch a class in heart?", truth: "true" },
  { book: "heart", question: "Is knight a class in heart?", truth: "false" },
  { book: "heart", question: "Is witch hunter a class in heart?", truth: "false" },
  { book: "heart", question: "Is heretic a calling in heart?", truth: "false" },
  {
    book: "heart",
    question: "What are the skills available to a character?",
    truth: "passage",
    page: 12,
    // With their colons: "SKILLS" holds "KILL".
    contains: ["COMPEL:", "DELVE:", "DISCERN:", "ENDURE:", "EVADE:", "HUNT:", "KILL:", "MEND:", "SNEAK:"],
    without: ["CURSED"],
  },
  {
    book: "heart",
    question: "what are the equipment tags",
    truth: "passage",
    page: 102,
    contains: ["BLOCK:", "BLOODBOUND:", "EXPENSIVE:", "RANGED:"],
    without: ["Resources & Equipment"],
  },
  { book: "fallout", question: "How many perks are there?", truth: 94, page: 61 },
  { book: "fallout", question: "How many skills are there?", truth: 17, page: 46 },
  { book: "fallout", question: "How many origins are there?", truth: 6, page: 53, known: "the contents list five; Brotherhood Initiate has no bookmark" },
  { book: "fallout", question: "Is Gunslinger a perk?", truth: "true" },
  { book: "fallout", question: "Is Lockpick a perk?", truth: "false" },
  { book: "fallout", question: "How is radiation treated?", truth: "passage", page: 171, contains: ["RadAway"] },
  {
    book: "fallout",
    question: "What is the cost, weight and damage rating of a combat rifle?",
    truth: "cost 117, weight 11, damage rating 5",
    page: 97,
  },
  { book: "fallout", question: "What is the cost, weight and damage rating of a hunting rifle?", truth: "cost 55, weight 10, damage rating 6", page: 97 },
  { book: "litm", question: "How many theme types are there?", truth: 20, page: 75 },
  { book: "litm", question: "How many theme kits are there?", truth: 153, page: 76, known: "the second page sits at the answer floor and is counted one run, refused the next" },
  { book: "litm", question: "How many tropes are there?", truth: 30, page: 78, known: "the contents list the ten trope groups" },
  {
    book: "litm",
    question: "How does hero creation work in Legend in the Mist?",
    truth: "passage",
    page: 73,
    contains: ["The Simplest Way", "The Quickest Way", "The Detailed Way"],
  },
  {
    book: "cpr",
    question: "How many skills are there in the game?",
    truth: 66,
    page: 132,
    known: "counts 54 to 61 of 66; when the contents do not confine, Needed Skills (four healing skills) may be counted instead",
  },
  {
    book: "cpr",
    question: "Show me the exotic weapons table",
    truth: "passage",
    // The walk takes the price table on p.96 or the one on p.348 run to run;
    // either way a row reads name before cost, though its centred cells set
    // its other cells higher than the name.
    contains: ["Air Pistol", "100eb (Premium)", "Dartgun", "Flamethrower", "Kendachi Mono-Three"],
  },
  // A figure for each of several things is read as a passage, not one figure.
  {
    book: "cpr",
    question: "How much do each type of magazine cost in cyberpunk red?",
    truth: "passage",
    page: 344,
    contains: ["Drum Magazine", "500eb", "Extended Magazine", "100eb"],
  },
  // The note under each weapon's row must not break the table apart, and
  // only the damage column stays beside the name.
  {
    book: "cpr",
    question: "What is the damage of all the standard ranged weapons?",
    truth: "passage",
    contains: ['"Medium Pistol","Single Shot Damage":"2d6"', '"Rocket Launcher","Single Shot Damage":"8d6"'],
    without: ["Standard Magazine", "Cost", "Alt. Fire"],
  },
  {
    book: "fallout",
    question: "What is the cost and weight of every small gun?",
    truth: "passage",
    page: 97,
    contains: ['"Combat Rifle","WEIGHT":"11","COST":"117"', '"Hunting Rifle","WEIGHT":"10","COST":"55"'],
    without: ["DAMAGE"],
  },
  // "damage" is one column, DAMAGE RATING, not DAMAGE EFFECTS or TYPE too.
  {
    book: "fallout",
    question: "What is the damage of every small gun?",
    truth: "passage",
    page: 97,
    contains: ['"Combat Rifle","DAMAGE RATING":"5 CD"'],
    without: ["DAMAGE EFFECTS", "DAMAGE TYPE", "COST"],
  },
];

type Result = {
  book: string;
  question: string;
  truth: Case["truth"];
  got: string | undefined;
  p: number | undefined;
  page: number | undefined;
  /** 1 is right; a count scores by how close; a passage by the share of its checks met. */
  score: number;
  ms: number;
  known?: string;
};
type Run = { at: string; commit: string; model: string; results: Result[] };

function score(c: Case, got: string | undefined, page: number | undefined): number {
  if (got === undefined) return 0;
  if (typeof c.truth === "number") {
    const n = Number(got);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, 1 - Math.abs(n - c.truth) / c.truth);
  }
  if (c.truth === "passage") {
    const checks = [c.page === undefined || page === c.page, ...(c.contains ?? []).map((s) => got.includes(s)), ...(c.without ?? []).map((s) => !got.includes(s))];
    let ordered = true;
    for (let i = 1; i < (c.contains?.length ?? 0); i++) if (got.indexOf(c.contains![i]!) < got.indexOf(c.contains![i - 1]!)) ordered = false;
    checks.push(ordered);
    return checks.filter(Boolean).length / checks.length;
  }
  return got === c.truth ? 1 : 0;
}

const args = Bun.argv.slice(2);
const save = !args.includes("--no-save") && !args.includes("--no-search");
const search = !args.includes("--no-search");
const only = args.filter((a) => !a.startsWith("--"));
const picked = CASES.filter((c) => only.length === 0 || only.some((o) => c.book.includes(o) || c.question.toLowerCase().includes(o.toLowerCase())));

const client = await makeClient(DEFAULT_MODEL);
const ui = makeUi(true);
const results: Result[] = [];
let skipped = 0;
for (const c of picked) {
  const pdf = process.env[BOOKS[c.book]] ?? "";
  if (!pdf || !(await Bun.file(pdf).exists())) {
    console.error(`skip ${c.book}: ${BOOKS[c.book]} unset or missing`);
    skipped++;
    continue;
  }
  const t = Date.now();
  let r: Outcome | undefined;
  try {
    const opts = await answerLayer(client, { ...readDefaults(), search, question: c.question, quiet: true, ...c.opts }, ui);
    r = await searchPdf(client, pdf, opts, ui);
  } catch (e) {
    console.error(`${c.question}: ${e instanceof Error ? e.message : e}`);
  }
  // The hit, or failing that the best of what was kept, or nothing.
  const best = r?.hit ? { hit: r.hit, answer: r.hit.answer } : r?.rejected.length ? r.rejected.reduce((a, b) => (b.answer.p > a.answer.p ? b : a)) : undefined;
  const got = best?.answer?.text;
  const page = best?.hit.page;
  const answer = best?.answer;
  results.push({ book: c.book, question: c.question, truth: c.truth, got, p: answer?.p, page, score: score(c, got, page), ms: Date.now() - t, known: c.known });
}

const snapshot = Bun.fileURLToPath(new URL("bench/latest.json", import.meta.url));
const file = Bun.file(snapshot);
const last: Run | undefined = (await file.exists()) ? await file.json() : undefined;
const previous = new Map(last?.results.map((r) => [r.question, r]) ?? []);

const short = (s: string | undefined, n: number) => (s === undefined ? "—" : s.replace(/\n/g, " ").length > n ? `${s.replace(/\n/g, " ").slice(0, n - 1)}…` : s.replace(/\n/g, " "));
const pct = (x: number | undefined) => (x === undefined ? "  —" : `${Math.round(x * 100)}%`.padStart(4));
console.log(`${"case".padEnd(52)} ${"truth".padEnd(10)} ${"got".padEnd(22)} ${"p".padStart(5)} ${"page".padStart(5)} ${"score".padStart(5)} ${"last".padStart(5)}  ${"time".padStart(6)}`);
let regressions = 0;
for (const r of results) {
  const was = previous.get(r.question);
  const delta = was ? r.score - was.score : 0;
  const mark = delta < -0.05 ? " ↓" : delta > 0.05 ? " ↑" : "";
  if (delta < -0.05) regressions++;
  const truth = typeof r.truth === "string" && r.truth.length > 10 ? "figures" : String(r.truth);
  console.log(
    `${short(`${r.book}: ${r.question}`, 52).padEnd(52)} ${truth.padEnd(10)} ${short(r.got, 22).padEnd(22)} ${(r.p === undefined ? "—" : r.p.toFixed(2)).padStart(5)} ${String(r.page ?? "—").padStart(5)} ${pct(r.score)} ${pct(was?.score)}${mark.padEnd(2)} ${`${(r.ms / 1000).toFixed(1)}s`.padStart(6)}${r.known ? `  (${r.known})` : ""}`,
  );
}
const mean = results.reduce((s, r) => s + r.score, 0) / Math.max(1, results.length);
const lastMean = last ? last.results.reduce((s, r) => s + r.score, 0) / Math.max(1, last.results.length) : undefined;
console.log(`\nmean score ${pct(mean)}${lastMean !== undefined ? ` (last ${pct(lastMean)}, ${last!.commit} ${last!.at.slice(0, 10)})` : ""}, ${regressions} regression${regressions === 1 ? "" : "s"}`);

// A partial run is not a baseline: a skipped case would vanish from the record.
if (save && only.length === 0 && skipped === 0) {
  const commit = (await Bun.$`git rev-parse --short HEAD`.text()).trim();
  const run: Run = { at: new Date().toISOString(), commit, model: DEFAULT_MODEL, results };
  await Bun.write(snapshot, `${JSON.stringify(run, null, 2)}\n`);
  console.log("wrote bench/latest.json");
} else if (skipped) console.log("not saved: a book was skipped");
process.exit(regressions > 0 ? 1 : 0);
