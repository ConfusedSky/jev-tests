import { describe, expect, test } from "bun:test";
import { excerpts, stems, terms } from "./search";

describe("terms", () => {
  test("the subject weighs most, as a phrase and as words; other content words weigh one", () => {
    const ts = terms("What is the cost, weight and damage rating of a hunting rifle?", ["hunting rifle"]);
    expect(ts.map((t) => [t.words.join(" "), t.weight])).toEqual([
      ["hunting rifle", 3],
      ["hunting", 2],
      ["rifle", 2],
      ["cost", 1],
      ["weight", 1],
      ["damage", 1],
      ["rating", 1],
    ]);
    expect(ts.filter((t) => t.subject).map((t) => t.words.join(" "))).toEqual(["hunting rifle", "hunting", "rifle"]);
  });

  test("the game's name is never a term, subject or not", () => {
    const ts = terms("What are the available perks in fallout?", ["perks", "fallout"], ["fallout"]);
    expect(ts.map((t) => t.words.join(" "))).toEqual(["perk", "available"]);
  });

  test("matches in singular lower-case stems", () => {
    expect(stems("The Equipment Tags:")).toEqual(["equipment", "tag"]);
    expect(terms("What are the equipment tags?", ["equipment tags"])[0]!.words).toEqual(["equipment", "tag"]);
  });
});

describe("excerpts", () => {
  const ts = terms("What is the cost and weight of a hunting rifle?", ["hunting rifle"]);
  let n = 0;
  /** A cached text as pdftotext writes it: a form feed at the head of every page after the first. */
  const book = async (pages: string[]) => {
    const path = `${process.env.XDG_CACHE_HOME}/book-${n++}.txt`;
    await Bun.write(path, `${pages.join("\n\f")}\n`);
    return path;
  };
  const pagesOf = async (pages: string[], opts?: Parameters<typeof excerpts>[2]) => {
    const file = await book(pages);
    return (await excerpts([file], ts, opts)).get(file) ?? [];
  };

  test("picks the page's best line and ranks pages by it", async () => {
    const out = await pagesOf(["Weapons cost caps and have weight.", "Hunting Rifle      117    11\nCombat Rifle   200  12", "A hunting trip.\nThe rifle is heavy."]);
    expect(out.map((e) => e.page)).toEqual([2, 3]);
    expect(out[0]!.content).toBe("Hunting Rifle | 117 | 11");
  });

  test("a word on every page weighs nothing; a rare one keeps its weight", async () => {
    const out = await pagesOf(["cost of a rifle", "cost of bread", "cost of a hunting knife", "cost of time"]);
    // "hunting" is on one page and "rifle" on one; "cost" is everywhere and adds nothing.
    expect(out.map((e) => e.page)).toEqual([1, 3]);
    expect(out[0]!.score).toBeCloseTo(out[1]!.score);
  });

  test("a page whose best line never names the subject is left out", async () => {
    expect(await pagesOf(["The cost and weight of everything."])).toEqual([]);
  });

  test("without a subject, a line needs two terms", async () => {
    const file = await book(["cost", "cost and weight"]);
    const out = (await excerpts([file], terms("cost and weight", []))).get(file)!;
    expect(out.map((e) => e.page)).toEqual([2]);
  });

  test("a phrase split over a line break still matches", async () => {
    const out = await pagesOf(["the hunting\nrifle is good"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.score).toBeGreaterThan(0);
  });

  test("among pages with the same best line, the one naming the subject on more lines ranks first", async () => {
    const file = await book(["skill", "skill\nskill\nskill", "skill\nskill"]);
    const out = (await excerpts([file], terms("How many skills?", ["skills"]))).get(file)!;
    expect(out.map((e) => e.page)).toEqual([2, 3, 1]);
  });

  test("keeps to the pages allowed and to the limit", async () => {
    const pages = ["hunting rifle", "hunting rifle", "hunting rifle"];
    expect((await pagesOf(pages, { within: (p) => p > 1 })).map((e) => e.page)).toEqual([2, 3]);
    expect((await pagesOf(pages, { limit: 1 })).map((e) => e.page)).toEqual([1]);
  });

  test("an empty page still counts as a page", async () => {
    expect((await pagesOf(["", "", "hunting rifle"])).map((e) => e.page)).toEqual([3]);
  });

  test("the content is cut around the first match and holds no quotes", async () => {
    const line = `${"x ".repeat(100)}"hunting rifle" ${"y ".repeat(100)}`;
    const [e] = await pagesOf([line]);
    expect(e!.content.length).toBeLessThanOrEqual(200);
    expect(e!.content).toContain("hunting rifle");
    expect(e!.content).not.toContain('"');
  });

  test("several files go through one ripgrep and come back apart", async () => {
    const [a, b] = [await book(["a hunting rifle"]), await book(["nothing here", "a rifle for hunting"])];
    const out = await excerpts([a, b], ts);
    expect(out.get(a)!.map((e) => e.page)).toEqual([1]);
    expect(out.get(b)!.map((e) => e.page)).toEqual([2]);
  });
});
