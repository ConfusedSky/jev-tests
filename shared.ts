import { TypeSafeClient, score, type ScoreResponse } from "@typesafe-ai/sdk";

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
  const apiKey = process.env.OPENROUTER_API_KEY ?? (await keyFromScriptEnv());
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY is not set");
    process.exit(2);
  }
  return new TypeSafeClient({
    apiKey,
    baseURL: "https://openrouter.ai/api",
    defaultModel: model,
  });
}

export const DEFAULT_MODEL = process.env.JEVGREP_MODEL ?? "~typesafe/jev-latest";

// Jev returns no prose, so the reason is built from the rubric level it landed
// on plus how much probability mass sits there.
export function reason(a: ScoreResponse): string {
  const level = Math.round(a.score);
  const label = (a.legend as Record<string, string>)[String(level)] ?? "?";
  const p = (a.probabilities as Record<string, number>)[String(level)] ?? 0;
  return `${label} (p=${p.toFixed(2)} conf=${a.confidence.toFixed(2)})`;
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

/** "1.4s (jev 1.1s, read 0.2s, other 0.1s)" for everything since the snapshot. */
export function split(s: Snapshot): string {
  const fmt = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const total = Date.now() - s.at;
  const api = clock.api - s.api;
  const extract = clock.extract - s.extract;
  const wait = clock.wait - s.wait;
  const parts = [`jev ${fmt(api)}`, `read ${fmt(extract)}`];
  if (wait > 0) parts.push(`stdin ${fmt(wait)}`);
  parts.push(`other ${fmt(Math.max(0, total - api - extract - wait))}`);
  return `${fmt(total)} (${parts.join(", ")})`;
}

export type Ranked = { name: string; score: number; confidence: number; reason: string };

/** Score many short strings against one question, batched into fan-out calls. */
export async function rankTitles(
  client: TypeSafeClient,
  question: string,
  names: string[],
  batch: number,
  subject: string,
): Promise<Ranked[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < names.length; i += batch) chunks.push(names.slice(i, i + batch));
  const scored = await timed("api", () => Promise.all(
    chunks.map(async (chunk) => {
      const questions = Object.fromEntries(
        chunk.map((name, i) => [`f${i}`, score(`The ${subject} "${name}" answers the question`, RUBRIC)]),
      );
      const res = await client.systemOne({
        state: { question, candidates: chunk },
        questions,
      });
      return chunk.map((name, i) => {
        const a = res.answers[`f${i}`] as ScoreResponse;
        return { name, score: a.score, confidence: a.confidence, reason: reason(a) };
      });
    }),
  ));
  return scored.flat().sort((a, b) => b.score - a.score || b.confidence - a.confidence);
}
