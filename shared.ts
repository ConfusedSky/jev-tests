import { TypeSafeClient, score, type JsonValue, type ScoreResponse } from "@typesafe-ai/sdk";
import { makeSemifClient } from "./semif";

export const RUBRIC = [
  "Unrelated to the question",
  "Related area, but unlikely to hold the answer",
  "Plausibly holds part of the answer",
  "Directly names the subject of the question",
] as const;

// Bun only auto-loads .env from the cwd, and these run from any directory.
export async function keyFromScriptEnv(): Promise<string | undefined> {
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
  const client = new TypeSafeClient({
    apiKey,
    baseURL: "https://openrouter.ai/api",
    defaultModel: model,
    // A page's worth of sentence nouls with the page in the state outran the
    // SDK's ten seconds on a slow day, and a timed-out passage is a blank.
    timeout: 60_000,
  });
  return counted(client);
}

/** `client` with every call's tokens added to `tokens`, so each step can say what it spent. */
export function counted(client: TypeSafeClient): TypeSafeClient {
  const one = client.systemOne.bind(client);
  client.systemOne = (async (...args: Parameters<typeof one>) => {
    const res = await one(...args);
    tokens.in += res.usage?.input_tokens ?? 0;
    tokens.out += res.usage?.output_tokens ?? 0;
    return res;
  }) as typeof client.systemOne;
  return client;
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
 * Wall time spent waiting on jev versus shelling out to pdftotext/mutool,
 * reading stdin, embedding for the ranking cache, marking the answer in a
 * copy, and reading the marked pages' sizes for --json.
 * Parallel work is timed as one span so the parts never exceed the elapsed time.
 */
export const clock = { api: 0, extract: 0, wait: 0, embed: 0, highlight: 0, sizes: 0 };

export async function timed<T>(kind: keyof typeof clock, fn: () => Promise<T>): Promise<T> {
  const t = Date.now();
  try {
    return await fn();
  } finally {
    clock[kind] += Date.now() - t;
  }
}

/** Tokens jev has read and written this run. */
export const tokens = { in: 0, out: 0 };

/** jev's price per million input tokens; its output tokens are free. */
export const DOLLARS_PER_MILLION_IN = 0.042;

export type Snapshot = { at: number; api: number; extract: number; wait: number; embed: number; highlight: number; sizes: number; in: number; out: number };
export const snapshot = (): Snapshot => ({ at: Date.now(), ...clock, ...tokens });

/** "12,345 tokens in, 60 out, $0.00052" for the tokens since the snapshot, or "" when there were none. */
export function spent(s: Pick<Snapshot, "in" | "out">): string {
  const [i, o] = [tokens.in - s.in, tokens.out - s.out];
  if (i === 0 && o === 0) return "";
  return `${i.toLocaleString("en-US")} tokens in, ${o.toLocaleString("en-US")} out, $${((i / 1e6) * DOLLARS_PER_MILLION_IN).toFixed(5)}`;
}

export const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Time in milliseconds and tokens since a snapshot, the figures `split` prints. */
export type Spent = { in: number; out: number; dollars: number; ms: { total: number; jev: number; read: number; stdin: number; embed: number; highlight: number; sizes: number; other: number } };

export function spentSince(s: Snapshot): Spent {
  const total = Date.now() - s.at;
  const [jev, read, stdin, embed, highlight, sizes] = [clock.api - s.api, clock.extract - s.extract, clock.wait - s.wait, clock.embed - s.embed, clock.highlight - s.highlight, clock.sizes - s.sizes];
  const i = tokens.in - s.in;
  return {
    in: i,
    out: tokens.out - s.out,
    dollars: (i / 1e6) * DOLLARS_PER_MILLION_IN,
    ms: { total, jev, read, stdin, embed, highlight, sizes, other: Math.max(0, total - jev - read - stdin - embed - highlight - sizes) },
  };
}

/** "1.4s (jev 1.1s, read 0.2s, other 0.1s; 12,345 tokens in, 60 out, $0.00052)" for everything since the snapshot. */
export function split(s: Snapshot): string {
  const { ms } = spentSince(s);
  const parts = [`jev ${secs(ms.jev)}`, `read ${secs(ms.read)}`];
  if (ms.stdin > 0) parts.push(`stdin ${secs(ms.stdin)}`);
  if (ms.embed > 0) parts.push(`embed ${secs(ms.embed)}`);
  if (ms.highlight > 0) parts.push(`highlight ${secs(ms.highlight)}`);
  if (ms.sizes > 0) parts.push(`sizes ${secs(ms.sizes)}`);
  parts.push(`other ${secs(ms.other)}`);
  const cost = spent(s);
  return `${secs(ms.total)} (${parts.join(", ")}${cost ? `; ${cost}` : ""})`;
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
