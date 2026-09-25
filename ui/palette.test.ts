import { describe, expect, test } from "bun:test";
import { matchItems, type Item } from "./palette";

const item = (id: string, label: string, hint?: string, keywords?: string): Item => ({ id, group: "g", label, hint, keywords, run: () => {} });
const items = [item("a", "Ask the whole shelf", "jevfind"), item("b", "Ask one PDF", "jevsec", "book"), item("c", "Dark theme", undefined, "light mode appearance"), item("d", "Copy the answer")];

describe("matchItems", () => {
  test("keeps every item for an empty query", () => {
    expect(matchItems(items, " ").map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });

  test("matches every word against label, hint and keywords, label starts first", () => {
    expect(matchItems(items, "ask pdf").map((i) => i.id)).toEqual(["b"]);
    expect(matchItems(items, "book").map((i) => i.id)).toEqual(["b"]);
    expect(matchItems(items, "mode").map((i) => i.id)).toEqual(["c"]);
    expect(matchItems(items, "ask the").map((i) => i.id)).toEqual(["a"]);
    expect(matchItems(items, "the").map((i) => i.id)).toEqual(["a", "c", "d"]);
    expect(matchItems(items, "a").map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
    expect(matchItems(items, "zzz")).toEqual([]);
  });

  test("stops at the limit", () => {
    expect(matchItems(items, "", 2).length).toBe(2);
  });
});
