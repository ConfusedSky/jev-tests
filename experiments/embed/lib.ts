import { mkdir } from "node:fs/promises";
import { bookText, outline, type Section } from "../../pdf";

export const BOOKS = { heart: "JEV_HEART_PDF", litm: "JEV_LITM_PDF", cpr: "JEV_CPR_PDF", fallout: "JEV_FALLOUT_PDF" } as const;
export type Book = keyof typeof BOOKS;
export const DIR = new URL("./cache/", import.meta.url).pathname;
export const MODEL = process.env.EMB_MODEL ?? "qwen3-embedding:4b";
const tag = MODEL.replace(/[^a-z0-9.]+/gi, "_");

export const PAGE_PREFIX = "Instruct: Given a question about a tabletop rulebook, retrieve the rulebook page that answers it\nQuery: ";
export const SEC_PREFIX = "Instruct: Given a question about a tabletop rulebook, retrieve the rulebook section that answers it\nQuery: ";

export async function embed(input: string[]): Promise<number[][]> {
  const r = await fetch("http://localhost:11434/api/embed", { method: "POST", body: JSON.stringify({ model: MODEL, input }) });
  if (!r.ok) throw new Error(await r.text());
  return ((await r.json()) as { embeddings: number[][] }).embeddings;
}

export const norm = (v: number[]) => {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / n);
};
export const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i]! * b[i]!;
  return d;
};

/** Page text, whitespace collapsed, cut into chunks of at most CHUNK chars (equal parts). */
export const CHUNK = 6000;
export function chunks(text: string): string[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= CHUNK) return [t];
  const n = Math.ceil(t.length / CHUNK);
  const size = Math.ceil(t.length / n);
  return Array.from({ length: n }, (_, i) => t.slice(i * size, (i + 1) * size));
}

export const narrowest = (sections: Section[], page: number) =>
  sections.filter((s) => page >= s.start && page <= s.end).sort((a, b) => a.end - a.start - (b.end - b.start) || b.path.split(" > ").length - a.path.split(" > ").length)[0];

type Store = { items: { page?: number; path?: string }[]; dim: number; vecs: Float32Array };

async function load(file: string): Promise<Store | undefined> {
  const meta = Bun.file(`${file}.json`);
  if (!(await meta.exists())) return undefined;
  const m = (await meta.json()) as { items: Store["items"]; dim: number };
  return { ...m, vecs: new Float32Array(await Bun.file(`${file}.f32`).arrayBuffer()) };
}

async function build(file: string, items: Store["items"], texts: string[], log: string): Promise<Store> {
  const have = await load(file);
  if (have) return have;
  await mkdir(DIR, { recursive: true });
  const out: number[][] = [];
  const t = Date.now();
  for (let i = 0; i < texts.length; i += 8) {
    out.push(...(await embed(texts.slice(i, i + 8))).map(norm));
    if (i % 80 === 0) console.error(`${log} ${i}/${texts.length} ${((Date.now() - t) / 1000).toFixed(0)}s`);
  }
  const dim = out[0]!.length;
  const vecs = new Float32Array(out.flat());
  await Bun.write(`${file}.f32`, vecs.buffer);
  await Bun.write(`${file}.json`, JSON.stringify({ items, dim, ms: Date.now() - t }));
  return { items, dim, vecs };
}

export type Index = { pdf: string; pages: string[]; sections: Section[]; pageChunks: Store; secPageChunks: Store; titles: Store };

/** variants: "page" = page text; "secpage" = narrowest section path + page text; "title" = each section's path. */
export async function index(book: Book, variants: ("page" | "secpage" | "title")[] = ["page", "secpage", "title"]): Promise<Index> {
  const pdf = process.env[BOOKS[book]]!;
  const pages = await bookText(pdf);
  const sections = await outline(pdf);
  const pc = pages.flatMap((p, i) => chunks(p).filter((c) => c.length > 0).map((c) => ({ page: i + 1, c })));
  const empty: Store = { items: [], dim: 0, vecs: new Float32Array() };
  const pageChunks = variants.includes("page") ? await build(`${DIR}${book}-page-${tag}`, pc.map((x) => ({ page: x.page })), pc.map((x) => x.c), `${book} page`) : empty;
  const secPageChunks = variants.includes("secpage")
    ? await build(`${DIR}${book}-secpage-${tag}`, pc.map((x) => ({ page: x.page })), pc.map((x) => `${narrowest(sections, x.page)?.path ?? ""}\n${x.c}`), `${book} secpage`)
    : empty;
  const titles = variants.includes("title") ? await build(`${DIR}${book}-title-${tag}`, sections.map((s) => ({ path: s.path })), sections.map((s) => s.path), `${book} title`) : empty;
  return { pdf, pages, sections, pageChunks, secPageChunks, titles };
}

export const vec = (s: Store, i: number) => s.vecs.subarray(i * s.dim, (i + 1) * s.dim);

/** Best cosine per page (max over its chunks), pages sorted best first. */
export function pageScores(s: Store, q: number[]): Map<number, number> {
  const best = new Map<number, number>();
  s.items.forEach((it, i) => {
    const c = dot(q, vec(s, i));
    if (c > (best.get(it.page!) ?? -2)) best.set(it.page!, c);
  });
  return best;
}
export const sorted = (m: Map<number, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
