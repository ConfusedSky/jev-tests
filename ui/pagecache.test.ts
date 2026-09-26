import { describe, expect, setSystemTime, test } from "bun:test";
import { mkdir, readdir, rm, utimes } from "node:fs/promises";
import { capOf, drawingName, overflow, PageCache, STALE_PART_MS, staleOf } from "./pagecache";

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
  const fresh = async (name: string) => {
    const dir = `${process.env.XDG_CACHE_HOME}/${name}`;
    await mkdir(dir, { recursive: true });
    return dir;
  };
  const alive = () => new AbortController().signal;

  test("takes in what is on disk oldest first, then holds the cap as pages are shown, and forgets a changed PDF", async () => {
    const dir = await fresh("ui-pages-test");
    const [a, b, c] = [1, 2, 3].map((n) => drawingName("/a.pdf", 1000, n, 800));
    for (const [i, name] of [a!, b!, c!].entries()) {
      await Bun.write(`${dir}/${name}`, "x".repeat(100));
      await utimes(`${dir}/${name}`, 1000 + i, 1000 + i);
    }
    const cache = new PageCache(dir, 250);
    await cache.sweep();
    // Three of 100 bytes against 250: the oldest goes.
    expect(cache.bytes).toBe(200);
    // Shown again, b is the newest; a fourth drawing pushes out c, now the oldest.
    await cache.use(b!, 100);
    const d = drawingName("/a.pdf", 1000, 4, 800);
    await Bun.write(`${dir}/${d}`, "x".repeat(100));
    await cache.use(d, 100);
    expect(cache.bytes).toBe(200);
    expect((await readdir(dir)).sort()).toEqual([b!, d].sort());
    // The PDF changed: its old drawings go.
    await cache.forget("/a.pdf", 5000);
    expect([cache.bytes, await readdir(dir)]).toEqual([0, []]);
  });

  // Two servers on one directory: each one's count drifts from the disk as the other adds and drops.
  test("reads the disk again before dropping for room, and when swept, so another server's drawings count and its drops do too", async () => {
    const dir = await fresh("ui-pages-shared");
    const [a, b, c, d, e] = [1, 2, 3, 4, 5].map((n) => drawingName("/a.pdf", 1000, n, 800));
    const one = new PageCache(dir, 250);
    for (const name of [a!, b!]) {
      await Bun.write(`${dir}/${name}`, "x".repeat(100));
      await one.use(name, 100);
    }
    // The other server drops b; c, shown here, is over the cap by this count alone, and a stays.
    await rm(`${dir}/${b}`);
    await Bun.write(`${dir}/${c}`, "x".repeat(100));
    await one.use(c!, 100);
    expect(one.bytes).toBe(200);
    expect((await readdir(dir)).sort()).toEqual([a!, c!].sort());
    // The other server draws d and e, shown before anything here: counted once swept, and the first to go.
    for (const [i, name] of [d!, e!].entries()) {
      await Bun.write(`${dir}/${name}`, "x".repeat(100));
      await utimes(`${dir}/${name}`, 1000 + i, 1000 + i);
    }
    await one.sweep();
    expect(one.bytes).toBe(200);
    expect((await readdir(dir)).sort()).toEqual([a!, c!].sort());
  });

  // Scrolling draws pages faster than the clock ticks: shows in one millisecond tied, and the one being shown could go.
  test("keeps the order of shows within one millisecond, dropping the first shown", async () => {
    const dir = await fresh("ui-pages-tick");
    const names = [1, 2, 3].map((n) => drawingName("/a.pdf", 1000, n, 800));
    const cache = new PageCache(dir, 250);
    setSystemTime(new Date(2_000_000_000_000));
    try {
      for (const name of names) {
        await Bun.write(`${dir}/${name}`, "x".repeat(100));
        await cache.use(name, 100);
      }
    } finally {
      setSystemTime();
    }
    expect(cache.bytes).toBe(200);
    expect((await readdir(dir)).sort()).toEqual(names.slice(1).sort());
  });

  test("removes a part a crash left, not one another server may be drawing still", async () => {
    const dir = await fresh("ui-pages-parts");
    const name = drawingName("/a.pdf", 1000, 1, 800);
    const [old, now] = [`${dir}/${name}.x.part`, `${dir}/${name}.y.part`];
    await Bun.write(old, "half");
    await Bun.write(now, "half");
    const then = (Date.now() - STALE_PART_MS - 60_000) / 1000;
    await utimes(old, then, then);
    await new PageCache(dir, 1e6).sweep();
    expect(await readdir(dir)).toEqual([`${name}.y.part`]);
  });

  test("makes a drawing once however many ask for it at once, and leaves no part", async () => {
    const dir = await fresh("ui-pages-once");
    const cache = new PageCache(dir, 1e6);
    const name = drawingName("/a.pdf", 1000, 1, 800);
    let draws = 0;
    const { promise: gate, resolve: go } = Promise.withResolvers<void>();
    const draw = async (part: string) => {
      draws++;
      await gate;
      await Bun.write(part, "png");
      return true;
    };
    const asks = [1, 2, 3].map(() => cache.make(name, alive(), draw));
    go();
    expect(await Promise.all(asks)).toEqual([true, true, true]);
    expect(draws).toBe(1);
    expect(await readdir(dir)).toEqual([name]);
    // Once there, it is not drawn again.
    expect(await cache.make(name, alive(), draw)).toBe(true);
    expect(draws).toBe(1);
  });

  test("draws nothing once every asker has gone, and fails every asker alike, leaving no part", async () => {
    const dir = await fresh("ui-pages-gone");
    const cache = new PageCache(dir, 1e6);
    const name = drawingName("/a.pdf", 1000, 1, 800);
    const left = new AbortController();
    left.abort();
    let draws = 0;
    const draw = async (part: string, wanted: () => boolean) => {
      if (!wanted()) return false;
      draws++;
      await Bun.write(part, "half");
      throw new Error("mutool failed");
    };
    expect(await cache.make(name, left.signal, draw)).toBe(false);
    expect(draws).toBe(0);
    const asks = [cache.make(name, alive(), draw), cache.make(name, left.signal, draw)].map((p) => p.catch((e: Error) => e.message));
    expect(await Promise.all(asks)).toEqual(["mutool failed", "mutool failed"]);
    expect(draws).toBe(1);
    expect(await readdir(dir)).toEqual([]);
  });
});
