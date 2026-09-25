/**
 * Rankings cached per book and reused for a similar question: ranking an
 * outline is most of what a question costs (about 37,000 tokens on the
 * Fallout book), and a question that would be answered by the same sections
 * can walk the ranking an earlier one made. Similarity is an embedding
 * model's; see docs/ranking-cache.md for how the models and bars were
 * chosen. A ranking is stored once per book, each model's embeddings of it
 * beside it, since embeddings from different models cannot be compared.
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Excerpt } from "./search";
import { timed, type Ranked } from "./shared";

export type CacheModel = {
  id: string;
  provider: "ollama" | "openrouter";
  /** The model's name to its provider. */
  name: string;
  /** Whether the new question gets Qwen's instruction prefix; it helped Qwen and never helped 3-small. */
  prefix: boolean;
  /** A hit needs the whole question to score this against a cached entry, or the subject `subject`. */
  whole: number;
  subject: number;
};

// Bars are the experiments' 100%-precision ones with a margin; each model's
// scores are on its own scale, so each has its own.
export const CACHE_MODELS: Record<string, CacheModel> = {
  "qwen3-4b": { id: "qwen3-4b", provider: "ollama", name: "qwen3-embedding:4b", prefix: true, whole: 0.53, subject: 0.8 },
  "qwen3-0.6b": { id: "qwen3-0.6b", provider: "ollama", name: "qwen3-embedding:0.6b", prefix: true, whole: 0.6, subject: 0.86 },
  "3-small": { id: "3-small", provider: "openrouter", name: "openai/text-embedding-3-small", prefix: false, whole: 0.56, subject: 0.7 },
};

// The texts must be the ones the bars were measured on, word for word.
const PREFIX = "Instruct: Given a question about a tabletop rulebook, retrieve cached questions answered by the same rulebook sections\nQuery: ";
export const queryText = (m: CacheModel, question: string) => (m.prefix ? PREFIX + question : question);
export const richText = (question: string, top: string[]) => `${question}\nSections: ${top.slice(0, 3).join("; ")}`;
export const subjectText = (subject: string[]) => subject.join(", ");

export type Embed = (texts: string[]) => Promise<number[][]>;

const OLLAMA = process.env.OLLAMA_HOST ? `http://${process.env.OLLAMA_HOST.replace(/^https?:\/\//, "")}` : "http://localhost:11434";

/** Embeds through the model's provider. */
export function embedder(m: CacheModel, fetchFn: typeof fetch = fetch): Embed {
  const embed = embedWith(m, fetchFn);
  return (input) => timed("embed", () => embed(input));
}

function embedWith(m: CacheModel, fetchFn: typeof fetch): Embed {
  if (m.provider === "ollama")
    return async (input) => {
      const r = await fetchFn(`${OLLAMA}/api/embed`, { method: "POST", body: JSON.stringify({ model: m.name, input }) });
      if (!r.ok) throw new Error(`ollama: ${await r.text()}`);
      return ((await r.json()) as { embeddings: number[][] }).embeddings;
    };
  return async (input) => {
    const r = await fetchFn("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ""}`, "content-type": "application/json" },
      body: JSON.stringify({ model: m.name, input }),
    });
    if (!r.ok) throw new Error(`openrouter: ${await r.text()}`);
    return ((await r.json()) as { data: { embedding: number[] }[] }).data.map((d) => d.embedding);
  };
}

/**
 * Why the cache cannot run with `m`, or undefined when it can: Ollama down or
 * without the model, or no OpenRouter key. The caller stops on it rather than
 * rank every book afresh, which costs real money.
 */
export async function unready(m: CacheModel, fetchFn: typeof fetch = fetch): Promise<string | undefined> {
  const off = "or pass --cache off to rank every book afresh (about 37,000 tokens a book on a long outline)";
  if (m.provider === "openrouter")
    return process.env.OPENROUTER_API_KEY ? undefined : `the ranking cache (--cache ${m.id}) needs OPENROUTER_API_KEY; set it, ${off}.`;
  let names: string[];
  try {
    const r = await fetchFn(`${OLLAMA}/api/tags`);
    names = ((await r.json()) as { models: { name: string }[] }).models.map((x) => x.name);
  } catch {
    return `the ranking cache (--cache ${m.id}) needs Ollama, and none answers at ${OLLAMA}. Start it with \`ollama serve\`, ${off}.`;
  }
  if (!names.some((n) => n === m.name || n === `${m.name}:latest`))
    return `the ranking cache (--cache ${m.id}) needs ${m.name} in Ollama. Get it with \`ollama pull ${m.name}\`, ${off}.`;
  return undefined;
}

/** A ranking a walk made and answered from, with what it was made for. */
export type Entry = { question: string; subject: string[]; top: string[]; all: Ranked[]; ex: Excerpt[]; at: string };
export type Found = { entry: Entry; whole: number; subject: number };

const cos = (a: number[], b: number[]) => {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i]! * b[i]!;
    na += a[i]! ** 2;
    nb += b[i]! ** 2;
  }
  return d / Math.sqrt(na * nb);
};

/** A book's directory in the cache, keyed as the text cache keys it, so a changed file starts afresh. */
export const bookKey = (pdf: string) => {
  const f = Bun.file(pdf);
  return `${Bun.hash(resolve(pdf)).toString(36).slice(0, 6)}-${f.size}-${Math.round(f.lastModified)}`;
};

/**
 * The cache for one question: `lookup` finds a cached ranking of a book
 * that serves it, `store` keeps the ranking it made once it answered.
 */
export type RankingCache = {
  lookup: (pdf: string) => Promise<Found | undefined>;
  store: (pdf: string, ranking: { all: Ranked[]; ex: Excerpt[] }) => Promise<void>;
};

export function rankingCache(m: CacheModel, embed: Embed, dir: string, question: string, subject: string[]): RankingCache {
  const paths = (pdf: string) => {
    const at = `${dir}/${bookKey(pdf)}`;
    return { at, rankings: `${at}/rankings.json`, embeddings: `${at}/embeddings-${m.id}.json` };
  };
  const read = async <T>(file: string, empty: T): Promise<T> => {
    const f = Bun.file(file);
    return (await f.exists()) ? ((await f.json()) as T) : empty;
  };
  type Vectors = Record<string, { rich: number[]; subject?: number[] }>;
  let query: Promise<number[][]> | undefined;
  return {
    async lookup(pdf) {
      const p = paths(pdf);
      const entries = await read<Entry[]>(p.rankings, []);
      if (entries.length === 0) return undefined;
      // An entry stored under another model is embedded for this one the
      // first time it is looked at, and kept.
      const vectors = await read<Vectors>(p.embeddings, {});
      const missing = entries.filter((e) => !vectors[e.question]);
      if (missing.length) {
        const rich = await embed(missing.map((e) => richText(e.question, e.top)));
        const withSubject = missing.filter((e) => e.subject.length);
        const subj = withSubject.length ? await embed(withSubject.map((e) => subjectText(e.subject))) : [];
        missing.forEach((e, i) => (vectors[e.question] = { rich: rich[i]! }));
        withSubject.forEach((e, i) => (vectors[e.question]!.subject = subj[i]!));
        await Bun.write(p.embeddings, JSON.stringify(vectors));
      }
      query ??= embed(subject.length ? [queryText(m, question), subjectText(subject)] : [queryText(m, question)]);
      const [q, s] = await query;
      let best: Found | undefined;
      for (const entry of entries) {
        const v = vectors[entry.question]!;
        const whole = cos(q!, v.rich);
        const sub = s && v.subject ? cos(s, v.subject) : -1;
        if (!(whole >= m.whole || sub >= m.subject)) continue;
        if (!best || whole > best.whole) best = { entry, whole, subject: sub };
      }
      return best;
    },
    async store(pdf, { all, ex }) {
      const p = paths(pdf);
      await mkdir(p.at, { recursive: true });
      const entries = (await read<Entry[]>(p.rankings, [])).filter((e) => e.question !== question);
      const top = all.filter((r) => r.list === "candidates").slice(0, 3).map((r) => r.name);
      entries.push({ question, subject, top, all, ex, at: new Date().toISOString() });
      await Bun.write(p.rankings, JSON.stringify(entries));
    },
  };
}
