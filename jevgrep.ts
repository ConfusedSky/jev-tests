#!/usr/bin/env bun
import { TypeSafeClient, score, type ScoreResponse } from "@typesafe-ai/sdk";

const RUBRIC = [
  "Unrelated to the question",
  "Related area, but unlikely to hold the answer",
  "Plausibly holds part of the answer",
  "Directly names the subject of the question",
] as const;

type Opts = {
  question: string;
  top: number;
  threshold: number;
  batch: number;
  model: string;
  json: boolean;
  namesOnly: boolean;
};

function parseArgs(argv: string[]): Opts {
  const o: Opts = {
    question: "",
    top: Infinity,
    threshold: 1.5,
    batch: 40,
    model: process.env.JEVGREP_MODEL ?? "~typesafe/jev-latest",
    json: false,
    namesOnly: false,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i] ?? "";
    if (a === "-n" || a === "--top") o.top = Number(next());
    else if (a === "-t" || a === "--threshold") o.threshold = Number(next());
    else if (a === "--batch") o.batch = Number(next());
    else if (a === "--model") o.model = next();
    else if (a === "--json") o.json = true;
    else if (a === "-l" || a === "--names-only") o.namesOnly = true;
    else if (a === "-h" || a === "--help") usage(0);
    else rest.push(a);
  }
  o.question = rest.join(" ").trim();
  if (!o.question) usage(1);
  return o;
}

function usage(code: number): never {
  const out = code === 0 ? console.log : console.error;
  out(`jevgrep — rank filenames by how likely they answer a question

  ls | jevgrep "What are the skills in the fallout rpg?"

  -n, --top N          keep only the N best matches
  -t, --threshold F    minimum score, 0-3 (default 1.5)
  -l, --names-only     print filenames only, pipe-clean
      --json           print full answers as JSON
      --batch N        filenames per API call (default 40)
      --model SLUG     default ~typesafe/jev-latest, or $JEVGREP_MODEL

Reads filenames on stdin. Never reads file contents.
Needs $OPENROUTER_API_KEY.`);
  process.exit(code);
}

// Jev returns no prose, so the reason is built from the rubric level it landed
// on plus how much probability mass sits there.
function reason(a: ScoreResponse): string {
  const level = Math.round(a.score);
  const label = (a.legend as Record<string, string>)[String(level)] ?? "?";
  const p = (a.probabilities as Record<string, number>)[String(level)] ?? 0;
  return `${label} (p=${p.toFixed(2)} conf=${a.confidence.toFixed(2)})`;
}

const opts = parseArgs(Bun.argv.slice(2));

// Bun only auto-loads .env from the cwd, and this runs from any directory.
async function keyFromScriptEnv(): Promise<string | undefined> {
  const f = Bun.file(new URL(".env", import.meta.url));
  if (!(await f.exists())) return undefined;
  for (const line of (await f.text()).split("\n")) {
    const m = /^\s*(?:export\s+)?OPENROUTER_API_KEY\s*=\s*(.*)$/.exec(line);
    if (m) return m[1]!.trim().replace(/^["']|["']$/g, "");
  }
}

const apiKey = process.env.OPENROUTER_API_KEY ?? (await keyFromScriptEnv());
if (!apiKey) {
  console.error("jevgrep: OPENROUTER_API_KEY is not set");
  process.exit(2);
}

const names = (await Bun.stdin.text())
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

if (names.length === 0) {
  console.error("jevgrep: no filenames on stdin");
  process.exit(2);
}

const client = new TypeSafeClient({
  apiKey,
  baseURL: "https://openrouter.ai/api",
  defaultModel: opts.model,
});

type Row = { name: string; score: number; confidence: number; reason: string };

async function rank(chunk: string[]): Promise<Row[]> {
  const questions = Object.fromEntries(
    chunk.map((name, i) => [
      `f${i}`,
      score(`The file named "${name}" answers the question`, RUBRIC),
    ]),
  );
  const res = await client.systemOne({
    state: { question: opts.question, candidate_filenames: chunk },
    questions,
  });
  return chunk.map((name, i) => {
    const a = res.answers[`f${i}`] as ScoreResponse;
    return { name, score: a.score, confidence: a.confidence, reason: reason(a) };
  });
}

const chunks: string[][] = [];
for (let i = 0; i < names.length; i += opts.batch)
  chunks.push(names.slice(i, i + opts.batch));

const rows = (await Promise.all(chunks.map(rank)))
  .flat()
  .filter((r) => r.score >= opts.threshold)
  .sort((a, b) => b.score - a.score || b.confidence - a.confidence)
  .slice(0, opts.top);

// Keep the tab-separated form when piped; align only for a human at a TTY.
function elideMiddle(s: string, w: number): string {
  if (s.length <= w) return s;
  const keep = w - 1;
  const head = Math.ceil(keep / 2);
  return s.slice(0, head) + "\u2026" + s.slice(s.length - (keep - head));
}

// The filename is what distinguishes siblings, so only the directories shrink.
function elidePath(s: string, w: number): string {
  if (s.length <= w) return s;
  const cut = s.lastIndexOf("/");
  if (cut < 0) return elideMiddle(s, w);
  const base = s.slice(cut + 1);
  const avail = w - base.length - 1;
  if (avail < 3) return elideMiddle(base, w);
  return `${elideMiddle(s.slice(0, cut), avail)}/${base}`;
}

function render(rows: Row[]): string[] {
  if (!process.stdout.isTTY)
    return rows.map((r) => `${r.score.toFixed(2)}\t${r.name}\t${r.reason}`);
  const cols = process.stdout.columns ?? 120;
  const reasonW = Math.max(...rows.map((r) => r.reason.length));
  const nameW = Math.max(
    24,
    Math.min(Math.max(...rows.map((r) => r.name.length)), cols - 4 - 2 - reasonW - 2),
  );
  return rows.map(
    (r) =>
      `${r.score.toFixed(2).padStart(4)}  ${elidePath(r.name, nameW).padEnd(nameW)}  ${r.reason}`,
  );
}

if (opts.json) console.log(JSON.stringify(rows, null, 2));
else if (opts.namesOnly) for (const r of rows) console.log(r.name);
else if (rows.length) for (const line of render(rows)) console.log(line);

process.exit(rows.length ? 0 : 1);
