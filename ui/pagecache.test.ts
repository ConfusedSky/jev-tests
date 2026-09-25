import { describe, expect, test } from "bun:test";
import { mkdir, readdir, utimes } from "node:fs/promises";
import { capOf, drawingName, overflow, PageCache, staleOf } from "./pagecache";

describe("overflow", () => {
  test("drops the least recently shown first, only until the rest fit", () => {
    expect(overflow([["a", 40], ["b", 30], ["c", 20], ["d", 10]], 35)).toEqual(["a", "b"]);
    expect(overflow([["a", 40], ["b", 30]], 70)).toEqual([]);
  });

  test("keeps the one being shown even when it alone is over the cap", () => {
    expect(overflow([["a", 10], ["b", 500]], 100)).toEqual(["a"]);
    expect(overflow([["a", 500]], 100)).toEqual([]);
  });
});

describe("staleOf", () => {
  test("names a PDF's drawings from before it changed, and no other PDF's", () => {
    const names = [drawingName("/a.pdf", 1000, 1, 800), drawingName("/a.pdf", 2000, 1, 800), drawingName("/a.pdf", 2000, 2, 1200), drawingName("/b.pdf", 1000, 1, 800)];
    expect(staleOf(names, "/a.pdf", 2000)).toEqual(names.slice(0, 1));
  });
});

describe("capOf", () => {
  test("takes megabytes from the environment, else 300", () => {
    expect([capOf("50"), capOf(undefined), capOf(""), capOf("lots"), capOf("-5")]).toEqual([50e6, 300e6, 300e6, 300e6, 300e6]);
  });
});

describe("PageCache", () => {
  test("takes in what is on disk oldest first, then holds the cap as pages are shown, and forgets a changed PDF", async () => {
    const dir = `${process.env.XDG_CACHE_HOME}/ui-pages-test`;
    await mkdir(dir, { recursive: true });
    const [a, b, c] = [1, 2, 3].map((n) => drawingName("/a.pdf", 1000, n, 800));
    for (const [i, name] of [a!, b!, c!].entries()) {
      await Bun.write(`${dir}/${name}`, "x".repeat(100));
      await utimes(`${dir}/${name}`, 1000 + i, 1000 + i);
    }
    const cache = new PageCache(dir, 250);
    await cache.load();
    // Three of 100 bytes against 250: the oldest goes.
    expect(cache.bytes).toBe(200);
    // Shown again, b is the newest; a fourth drawing pushes out c, now the oldest.
    cache.use(b!, 100);
    const d = drawingName("/a.pdf", 1000, 4, 800);
    await Bun.write(`${dir}/${d}`, "x".repeat(100));
    cache.use(d, 100);
    expect(cache.bytes).toBe(200);
    await Bun.sleep(20);
    expect((await readdir(dir)).sort()).toEqual([b!, d].sort());
    // The PDF changed: its old drawings go.
    cache.forget("/a.pdf", 5000);
    await Bun.sleep(20);
    expect([cache.bytes, await readdir(dir)]).toEqual([0, []]);
  });
});
