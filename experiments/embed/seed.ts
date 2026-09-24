// Copies build.ts's page vectors (same model, text and chunking as embed.ts) into the app's store, so a run needs no first-time embedding.
import { mkdir } from "node:fs/promises";
import { bookKey } from "../../cache";
import { cacheDir } from "../../pdf";
import { BOOKS, index, vec, type Book } from "./lib";

const dir = `${cacheDir()}/embeddings`;
await mkdir(dir, { recursive: true });
for (const b of Object.keys(BOOKS) as Book[]) {
  const x = await index(b, ["page"]);
  const file = `${dir}/${bookKey(x.pdf)}-pages-qwen3-4b.json`;
  const f = Bun.file(file);
  const store: Record<string, number[][]> = (await f.exists()) ? await f.json() : {};
  const fresh: Record<string, number[][]> = {};
  x.pageChunks.items.forEach((it, i) => (fresh[it.page!] ??= []).push([...vec(x.pageChunks, i)]));
  // Empty pages have no chunks.
  x.pages.forEach((_, i) => (fresh[i + 1] ??= []));
  // Compare against what the app embedded itself, where it did.
  const shared = Object.keys(store).filter((p) => store[p]!.length && fresh[p]!.length);
  const d = shared.map((p) => store[p]![0]!.reduce((s, v, j) => s + v * fresh[p]![0]![j]!, 0));
  console.log(b, Object.keys(store).length, "pages already stored; min cos app vs build", d.length ? Math.min(...d).toFixed(4) : "-");
  await Bun.write(file, JSON.stringify({ ...fresh, ...store }));
}
