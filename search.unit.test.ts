import { describe, expect, test } from "bun:test";
import { excerpts, stems, terms, weighted } from "./search";

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

  test("matches in singular lower-case stems", () => {
    expect(stems("The Equipment Tags:")).toEqual(["equipment", "tag"]);
    expect(terms("What are the equipment tags?", ["equipment tags"])[0]!.words).toEqual(["equipment", "tag"]);
  });
});

describe("weighted", () => {
  test("a word on every page weighs nothing; a rare one keeps its weight", () => {
    const pages = ["cost of a rifle", "cost of bread", "cost of a hunting rifle", "cost of time"];
    const ts = weighted(terms("cost of a hunting rifle", ["hunting rifle"]), pages);
    const by = Object.fromEntries(ts.map((t) => [t.words.join(" "), t.weight]));
    expect(by.cost).toBe(0);
    expect(by.hunting).toBeGreaterThan(by.rifle!);
    expect(by["hunting rifle"]).toBeGreaterThan(by.hunting!);
  });
});

describe("excerpts", () => {
  const ts = terms("What is the cost and weight of a hunting rifle?", ["hunting rifle"]);

  test("picks the page's best line and ranks pages by it", () => {
    const pages = ["Weapons cost caps and have weight.", "Hunting Rifle      117    11\nCombat Rifle   200  12", "A hunting trip.\nThe rifle is heavy."];
    const out = excerpts(pages, ts);
    expect(out.map((e) => e.page)).toEqual([2, 3]);
    expect(out[0]!.content).toBe("Hunting Rifle | 117 | 11");
  });

  test("a page whose best line never names the subject is left out", () => {
    expect(excerpts(["The cost and weight of everything."], ts)).toEqual([]);
  });

  test("without a subject, a line needs two terms", () => {
    const plain = terms("cost and weight", []);
    expect(excerpts(["cost", "cost and weight"], plain).map((e) => e.page)).toEqual([2]);
  });

  test("a phrase split over a line break still matches", () => {
    const out = excerpts(["the hunting\nrifle is good"], ts);
    expect(out).toHaveLength(1);
    expect(out[0]!.score).toBe(3 + 2);
  });

  test("keeps to the pages allowed and to the limit", () => {
    const pages = ["hunting rifle", "hunting rifle", "hunting rifle"];
    expect(excerpts(pages, ts, { within: (p) => p > 1 }).map((e) => e.page)).toEqual([2, 3]);
    expect(excerpts(pages, ts, { limit: 1 }).map((e) => e.page)).toEqual([1]);
  });

  test("the content is cut around the first match and holds no quotes", () => {
    const line = `${"x ".repeat(100)}"hunting rifle" ${"y ".repeat(100)}`;
    const [e] = excerpts([line], ts);
    expect(e!.content.length).toBeLessThanOrEqual(200);
    expect(e!.content).toContain("hunting rifle");
    expect(e!.content).not.toContain('"');
  });
});
