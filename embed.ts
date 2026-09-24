/**
 * Page embeddings, for picking the sections jev ranks on a long outline
 * (see `rankByPages` in pdf.ts): each page of a book is embedded once and
 * kept on disk per book. The chunking and prefix are the ones the choice of
 * 20 pages was measured with (docs/token-usage.md); change either and
 * remeasure (experiments/embed/).
 */
import { mkdir } from "node:fs/promises";
import { bookKey, CACHE_MODELS, embedder, type Embed } from "./cache";

const PREFIX = "Instruct: Given a question about a tabletop rulebook, retrieve the rulebook page that answers it\nQuery: ";
const CHUNK = 6000;

/** A page's text, whitespace collapsed, in equal chunks of at most CHUNK characters; the page scores its best chunk. */
export function chunks(text: string): string[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [];
  if (t.length <= CHUNK) return [t];
  const n = Math.ceil(t.length / CHUNK);
  const size = Math.ceil(t.length / n);
  return Array.from({ length: n }, (_, i) => t.slice(i * size, (i + 1) * size));
}

const unit = (v: number[]) => {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / n);
};
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);

type Store = Record<string, number[][]>;
/** Each book's page vectors, read from disk once a process. */
const stores = new Map<string, Promise<Store>>();

export type PageSim = (pages: { page: number; text: string }[]) => Promise<number[]>;

/**
 * Cosine of each page to `question`, embedding the pages the book's store
 * lacks and saving them; `embedding` hears how many, since a whole book
 * the first time takes minutes.
 */
export function pageSim(pdf: string, question: string, dir: string, embed: Embed = embedder(CACHE_MODELS["qwen3-4b"]!), embedding?: (pages: number) => void): PageSim {
  const file = `${dir}/${bookKey(pdf)}-pages-qwen3-4b.json`;
  let q: Promise<number[]> | undefined;
  const read = async () => {
    const f = Bun.file(file);
    return (await f.exists()) ? ((await f.json()) as Store) : {};
  };
  return async (pages) => {
    q ??= embed([PREFIX + question]).then(([v]) => unit(v!));
    let loading = stores.get(file);
    if (!loading) stores.set(file, (loading = read()));
    const store = await loading;
    const missing = pages.filter((p) => !store[p.page]);
    if (missing.length) {
      embedding?.(missing.length);
      const texts = missing.map((p) => chunks(p.text));
      const flat = texts.flat();
      const vecs: number[][] = [];
      for (let i = 0; i < flat.length; i += 8) vecs.push(...(await embed(flat.slice(i, i + 8))).map(unit));
      let at = 0;
      missing.forEach((p, i) => (store[p.page] = texts[i]!.map(() => vecs[at++]!)));
      // Merged with the file as it is now, so another process's pages survive.
      Object.assign(store, { ...(await read()), ...store });
      await mkdir(dir, { recursive: true });
      await Bun.write(file, JSON.stringify(store));
    }
    const qv = await q;
    // A page with no text scores as unlike anything.
    return pages.map((p) => Math.max(-1, ...store[p.page]!.map((v) => dot(qv, v))));
  };
}
