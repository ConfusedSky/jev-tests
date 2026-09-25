import { describe, expect, test } from "bun:test";
import { filterRuns, ordered, recentQuestions, remember } from "./history";
import type { Run } from "./run";

const run = (id: string, question: string, at: number, extra: Partial<Run> = {}): Run => ({
  id,
  request: { tool: "jevfind", question, options: {} as Run["request"]["options"], paths: ["/a.pdf"] },
  command: "",
  at,
  lines: [],
  status: "done",
  end: { type: "end", code: 0, ms: 1, report: { status: "answered", hits: [], spent: { in: 0, out: 0, dollars: 0, ms: { total: 0, jev: 0, read: 0, stdin: 0, embed: 0, highlight: 0, other: 0 } } } },
  ...extra,
});

describe("remember", () => {
  test("puts the run first, once, and drops the oldest unpinned past the cap", () => {
    const h = [run("b", "two", 2), run("a", "one", 1, { pinned: true })];
    const next = remember(h, run("c", "three", 3), 2);
    expect(next.map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(remember(next, run("d", "four", 4), 2).map((r) => r.id)).toEqual(["d", "c", "a"]);
  });

  test("keeps a run's pin when the run comes back ended", () => {
    const h = [run("a", "one", 1, { pinned: true, status: "running" })];
    expect(remember(h, run("a", "one", 1), 5)[0]!.pinned).toBe(true);
  });
});

describe("ordered", () => {
  test("lists the pinned first, each group newest first", () => {
    const h = [run("c", "three", 3), run("a", "one", 1, { pinned: true }), run("b", "two", 2)];
    expect(ordered(h).map((r) => r.id)).toEqual(["a", "c", "b"]);
  });
});

describe("filterRuns", () => {
  const h = [run("a", "How many skills are there?", 1), run("b", "How do I start?", 2, { request: { tool: "jevsec", question: "How do I start?", options: {} as Run["request"]["options"], pdf: "/books/Manual.pdf" } })];

  test("matches every word, against the question, the tool, the outcome and the PDF", () => {
    expect(filterRuns(h, "how").map((r) => r.id)).toEqual(["a", "b"]);
    expect(filterRuns(h, "skills how").map((r) => r.id)).toEqual(["a"]);
    expect(filterRuns(h, "manual").map((r) => r.id)).toEqual(["b"]);
    expect(filterRuns(h, "answered pdf").map((r) => r.id)).toEqual(["b"]);
    expect(filterRuns(h, "  ")).toBe(h);
  });
});

describe("recentQuestions", () => {
  test("offers distinct earlier questions holding the text, newest first, never the one being typed", () => {
    const h = [run("a", "How many skills are there?", 1), run("b", "how many skills are there?", 3), run("c", "How do I start?", 2), run("d", "What is a Vault?", 4)];
    expect(recentQuestions(h, "how")).toEqual(["how many skills are there?", "How do I start?"]);
    expect(recentQuestions(h, "How do I start?")).toEqual([]);
    expect(recentQuestions(h, "", 2)).toEqual(["What is a Vault?", "how many skills are there?"]);
  });
});
