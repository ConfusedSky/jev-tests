import { describe, expect, test } from "bun:test";
import { answerOf, filterRuns, ordered, recentQuestions, remember, restore, stepFrom, successor } from "./history";
import { parseLine } from "./log";
import type { JsonReport } from "./types";
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

describe("restore", () => {
  test("puts removed runs back newest first, keeps what is there, and holds the cap", () => {
    const [a, b, c] = [run("a", "one", 1), run("b", "two", 2), run("c", "three", 3)];
    expect(restore([b], [c, a], 5).map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(restore([{ ...b, pinned: true }], [b], 5)[0]!.pinned).toBe(true);
    expect(restore([b], [c, a], 2).map((r) => r.id)).toEqual(["c", "b"]);
  });
});

describe("stepFrom", () => {
  // Pinned first is the sidebar's order; stepping goes by time regardless.
  const h = [run("b", "two", 2, { pinned: true }), run("c", "three", 3), run("a", "one", 1)];

  test("steps older and newer in time, pins aside", () => {
    expect(stepFrom(h, "c", 1)?.id).toBe("b");
    expect(stepFrom(h, "b", 1)?.id).toBe("a");
    expect(stepFrom(h, "b", -1)?.id).toBe("c");
    expect(stepFrom(h, "a", 1)).toBeUndefined();
    expect(stepFrom(h, "c", -1)).toBeUndefined();
  });

  test("goes back to the newest from no run or one not in the history, the live run's case, and forward to nothing", () => {
    expect(stepFrom(h, undefined, 1)?.id).toBe("c");
    expect(stepFrom(h, "live", 1)?.id).toBe("c");
    expect(stepFrom(h, "live", -1)).toBeUndefined();
    expect(stepFrom([], undefined, 1)).toBeUndefined();
  });
});

describe("successor", () => {
  test("is the run after, else the one before, else none", () => {
    const list = [run("a", "one", 3), run("b", "two", 2), run("c", "three", 1)];
    expect(successor(list, "a")?.id).toBe("b");
    expect(successor(list, "c")?.id).toBe("b");
    expect(successor([list[0]!], "a")).toBeUndefined();
    expect(successor(list, "gone")).toBeUndefined();
  });
});

const answered = (id: string, question: string, report: Partial<JsonReport>): Run =>
  run(id, question, 1, { end: { type: "end", code: 0, ms: 1, report: { ...run("x", "", 0).end!.report!, ...report } } });
const hit = (answer: NonNullable<JsonReport["hits"][number]["answer"]>) => ({ pdf: "/b/Guide.pdf", view: "/b/Guide.pdf", page: 3, section: "Start", found: 0.9, answer });

describe("answerOf", () => {
  test("is the figure, True or False, or a passage's opening", () => {
    expect(answerOf(answered("a", "How many?", { kind: "count", hits: [hit({ text: "117", p: 0.9 })] }))).toBe("117");
    expect(answerOf(answered("a", "Is it?", { kind: "truth", hits: [hit({ text: "false", p: 0.9 })] }))).toBe("False");
    const passage = [
      { heading: true, text: "GETTING STARTED", style: "" },
      { heading: false, text: "Open the box and read the card.", style: "" },
    ];
    expect(answerOf(answered("a", "How?", { kind: "passage", hits: [hit({ text: "", p: 0.9, passage })] }))).toBe("GETTING STARTED Open the box and read the card.");
  });

  test("cuts a long passage at a word", () => {
    const text = "word ".repeat(60).trim();
    const a = answerOf(answered("a", "How?", { kind: "passage", hits: [hit({ text, p: 0.9 })] }))!;
    expect(a.length).toBeLessThanOrEqual(161);
    expect(a).toEndWith("word…");
  });

  test("names a table's size and the best names, and nothing for a run without an answer", () => {
    expect(answerOf(answered("a", "Table", { table: { rows: ["A", "B"], columns: ["x"], cells: [[{ text: "1", kind: "count" }], [{ text: "2", kind: "count" }]] } }))).toBe("a table of 2 × 1");
    expect(answerOf(run("a", "q", 1, { end: { type: "end", code: 0, ms: 1, ranked: [{ name: "/d/b.pdf", list: "names", index: 0, score: 2, confidence: 1, reason: "" }] } }))).toBe("b.pdf");
    expect(answerOf(run("a", "q", 1, { status: "stopped", end: { type: "end", code: null, ms: 1, error: "stopped" } }))).toBeUndefined();
  });
});

describe("filterRuns", () => {
  const h = [
    answered("a", "How many skills are there?", { kind: "count", hits: [hit({ text: "117", p: 0.9 })] }),
    run("b", "How do I start?", 2, { request: { tool: "jevsec", question: "How do I start?", options: {} as Run["request"]["options"], pdf: "/books/Manual.pdf" } }),
  ];

  test("matches every word, against the question, the tool, the outcome and the PDF", () => {
    expect(filterRuns(h, "how").map((r) => r.id)).toEqual(["a", "b"]);
    expect(filterRuns(h, "skills how").map((r) => r.id)).toEqual(["a"]);
    expect(filterRuns(h, "manual").map((r) => r.id)).toEqual(["b"]);
    expect(filterRuns(h, "answered pdf").map((r) => r.id)).toEqual(["b"]);
    expect(filterRuns(h, "  ")).toBe(h);
  });

  test("matches the answer and the kind, the kind read off the log when the run ended early", () => {
    expect(filterRuns(h, "117").map((r) => r.id)).toEqual(["a"]);
    expect(filterRuns(h, "count").map((r) => r.id)).toEqual(["a"]);
    const stopped = run("c", "Where is it?", 3, { status: "stopped", lines: [parseLine("question looks like a passage question  in 0.4s (jev 0.4s; 10 tokens in, 1 out, $0.00001)")] });
    expect(filterRuns([...h, stopped], "passage").map((r) => r.id)).toEqual(["c"]);
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
