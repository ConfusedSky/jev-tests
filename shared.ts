import { TypeSafeClient, score, type JsonValue, type ScoreResponse } from "@typesafe-ai/sdk";
import { makeSemifClient } from "./semif";

export const RUBRIC = [
  "Unrelated to the question",
  "Related area, but unlikely to hold the answer",
  "Plausibly holds part of the answer",
  "Directly names the subject of the question",
] as const;

// Bun only auto-loads .env from the cwd, and these run from any directory.
async function keyFromScriptEnv(): Promise<string | undefined> {
  const f = Bun.file(new URL(".env", import.meta.url));
  if (!(await f.exists())) return undefined;
  for (const line of (await f.text()).split("\n")) {
    const m = /^\s*(?:export\s+)?OPENROUTER_API_KEY\s*=\s*(.*)$/.exec(line);
    if (m) return m[1]!.trim().replace(/^["']|["']$/g, "");
  }
}

export async function makeClient(model: string): Promise<TypeSafeClient> {
  // --model semif answers from semif/server.py instead of jev; see README.
  if (model === "semif") return makeSemifClient(process.env.JEV_SEMIF_URL ?? "http://127.0.0.1:8765");
  const apiKey = process.env.OPENROUTER_API_KEY ?? (await keyFromScriptEnv());
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY is not set");
    process.exit(2);
  }
  return new TypeSafeClient({
    apiKey,
    baseURL: "https://openrouter.ai/api",
    defaultModel: model,
    // A page's worth of sentence nouls with the page in the state outran the
    // SDK's ten seconds on a slow day, and a timed-out passage is a blank.
    timeout: 60_000,
  });
}

export const DEFAULT_MODEL = process.env.JEVGREP_MODEL ?? "~typesafe/jev-latest";

// Jev returns no prose, so the reason is built from the rubric level it landed
// on plus how much probability mass sits there.
export function reason(a: ScoreResponse<typeof RUBRIC>): string {
  const level = Math.round(a.score) as 0 | 1 | 2 | 3;
  const p = a.probabilities[level] ?? 0;
  return `${RUBRIC[level] ?? "?"} (p=${p.toFixed(2)} conf=${a.confidence.toFixed(2)})`;
}

/**
 * Wall time spent waiting on jev versus shelling out to pdftotext/mutool.
 * Parallel work is timed as one span so the parts never exceed the elapsed time.
 */
export const clock = { api: 0, extract: 0, wait: 0 };

export async function timed<T>(kind: keyof typeof clock, fn: () => Promise<T>): Promise<T> {
  const t = Date.now();
  try {
    return await fn();
  } finally {
    clock[kind] += Date.now() - t;
  }
}

export type Snapshot = { at: number; api: number; extract: number; wait: number };
export const snapshot = (): Snapshot => ({ at: Date.now(), ...clock });

export const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** "1.4s (jev 1.1s, read 0.2s, other 0.1s)" for everything since the snapshot. */
export function split(s: Snapshot): string {
  const total = Date.now() - s.at;
  const api = clock.api - s.api;
  const extract = clock.extract - s.extract;
  const wait = clock.wait - s.wait;
  const parts = [`jev ${secs(api)}`, `read ${secs(extract)}`];
  if (wait > 0) parts.push(`stdin ${secs(wait)}`);
  parts.push(`other ${secs(Math.max(0, total - api - extract - wait))}`);
  return `${secs(total)} (${parts.join(", ")})`;
}

/** One list of candidates for a ranking call, named as the model sees it in `state`. */
export type List = { key: string; noun: string; items: { label: string; value: JsonValue }[] };
/** `list` and `index` say which item of which list scored; `name` is its label. */
export type Ranked = { name: string; list: string; index: number; score: number; confidence: number; reason: string };

/**
 * Score every item of every list against one question, batched into fan-out
 * calls. Lists share a call so a section title and a page excerpt are judged
 * in the same light; each chunk's state holds one key per list.
 */
export async function rank(client: TypeSafeClient, question: string, lists: List[], batch: number): Promise<Ranked[]> {
  const flat = lists.flatMap((l) => l.items.map((item, index) => ({ ...item, list: l, index })));
  const chunks: (typeof flat)[] = [];
  for (let i = 0; i < flat.length; i += batch) chunks.push(flat.slice(i, i + batch));
  const scored = await timed("api", () =>
    Promise.all(
      chunks.map(async (chunk) => {
        // Each list's slice of the chunk is an array in the state, and a
        // question names its item by position in that slice.
        const slices: Record<string, JsonValue[]> = {};
        const asked = chunk.map((item) => {
          const slice = (slices[item.list.key] ??= []);
          const id = `${item.list.key}${slice.length}`;
          const q = score(`The ${item.list.noun} \`${item.list.key}[${slice.length}]\` ("${item.label}") answers \`question\``, RUBRIC);
          slice.push(item.value);
          return { item, id, q };
        });
        const res = await client.systemOne({
          state: { question, ...slices },
          questions: Object.fromEntries(asked.map(({ id, q }) => [id, q])),
        });
        return asked.map(({ item, id }) => {
          const a = res.answers[id]!;
          return { name: item.label, list: item.list.key, index: item.index, score: a.score, confidence: a.confidence, reason: reason(a) };
        });
      }),
    ),
  );
  return scored.flat().sort((a, b) => b.score - a.score || b.confidence - a.confidence);
}

/** Score many short strings against one question, batched into fan-out calls. */
export function rankTitles(client: TypeSafeClient, question: string, names: string[], batch: number, subject: string): Promise<Ranked[]> {
  return rank(client, question, [{ key: "candidates", noun: subject, items: names.map((n) => ({ label: n, value: n })) }], batch);
}
