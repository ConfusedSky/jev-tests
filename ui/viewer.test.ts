import { describe, expect, test } from "bun:test";
import { parseLine } from "./log";
import type { Run } from "./run";
import type { JsonHit, JsonReport } from "./types";
import { layOut, pageAt, placed, renderWidth, scrollFor, splitAt, spotsOf, stepSpot, zoomStep } from "./viewer";

const spent = { in: 0, out: 0, dollars: 0, ms: { total: 0, jev: 0, read: 0, stdin: 0, embed: 0, highlight: 0, other: 0 } };
const run = (report: JsonReport | undefined, extra: Partial<Run> = {}): Run => ({
  id: "r",
  request: { tool: "jevfind", question: "q", options: {} as Run["request"]["options"], paths: ["/a.pdf"] },
  command: "",
  at: 0,
  lines: [],
  status: "done",
  end: { type: "end", code: 0, ms: 1, report },
  ...extra,
});
const size = { width: 600, height: 800 };
const mark = (page: number, y0: number) => ({ page, x0: 60, y0, x1: 540, y1: y0 + 12 });
const hit = (pdf: string, page: number, extra: Partial<JsonHit> = {}): JsonHit => ({
  pdf,
  view: pdf,
  page,
  section: "Rules > Start",
  found: 0.9,
  answer: { text: "Open the box and read the rules", p: 0.9 },
  marks: [],
  pages: {},
  ...extra,
});

describe("spotsOf", () => {
  test("lists each hit's marked pages in page order, passages in different books included", () => {
    const hits = [
      hit("/a.pdf", 12, { marks: [mark(13, 100), mark(12, 700), mark(12, 712)], pages: { 12: size, 13: size } }),
      hit("/b.pdf", 3, { marks: [mark(3, 40)], pages: { 3: size } }),
    ];
    const spots = spotsOf(run({ kind: "passage", status: "answered", hits, spent }));
    expect(spots.map((s) => [s.key, s.pdf, s.page, s.marks.length])).toEqual([
      ["h0", "/a.pdf", 12, 2],
      ["h0", "/a.pdf", 13, 1],
      ["h1", "/b.pdf", 3, 1],
    ]);
    expect(spots[0]!.size).toEqual(size);
    expect(spots[0]!.snippet).toBe("Open the box and read the rules");
  });

  test("keeps an unmarked hit's page, saying why: a statement, a run saved before marks were kept", () => {
    const truth = spotsOf(run({ kind: "truth", status: "answered", hits: [hit("/a.pdf", 5)], spent }));
    expect(truth).toMatchObject([{ page: 5, marks: [], unmarked: "a statement rests on no single line, so nothing is marked" }]);
    const { marks, pages, ...old } = hit("/a.pdf", 7);
    const saved = spotsOf(run({ kind: "passage", status: "answered", hits: [old as JsonHit], spent }));
    expect(saved).toMatchObject([{ page: 7, marks: [], unmarked: "this run was saved before highlights were kept with each run" }]);
  });

  test("says a count off the contents marks nothing, as the log's toc line tells", () => {
    const h = hit("/a.pdf", 40, { section: "Characters > Classes", answer: { text: "9", p: 1 } });
    const r = run({ kind: "count", status: "answered", hits: [h], spent }, { lines: [parseLine("toc   9 (p=1.00)  Characters > Classes  in 0.1s (jev 0.1s; 767 tokens in, 111 out, $0.00003)")] });
    expect(spotsOf(r)[0]!.unmarked).toStartWith("read off the table of contents");
  });

  test("goes through a table across the shelf a row at a time, each answered cell under its row and column", () => {
    const cell = (h?: JsonHit) => ({ text: h ? "9" : "N/A", kind: "count" as const, hit: h });
    const table = {
      rows: ["Heart", "Manual"],
      columns: ["skills", "classes"],
      cells: [
        [cell(hit("/h.pdf", 2, { marks: [mark(2, 10)] })), cell()],
        [cell(), cell(hit("/m.pdf", 1, { marks: [mark(1, 10)] }))],
      ],
    };
    const spots = spotsOf(run({ kind: "table", status: "answered", hits: [], table, spent }));
    expect(spots.map((s) => [s.key, s.cell])).toEqual([
      ["c0-0", "Heart × skills"],
      ["c1-1", "Manual × classes"],
    ]);
  });

  test("shows where a stopped walk had got to, unmarked, and nothing for a run with no answer", () => {
    const lines = ["ranked 3 paths and 0 excerpts in 0.2s (jev 0.2s; 10 tokens in, 1 out, $0.00001), 1 above file floor 1.5 (2 below)", "2.70  /books/Guide.pdf…", "  section Start  p.4-5…", "    yes  0.90  Start p.4 (window 1/2)", "    take  Open the box… (p=0.90)  Start p.4 (window 1/2)"].map((l) => parseLine(l));
    const stopped = run(undefined, { status: "stopped", lines });
    expect(spotsOf(stopped)).toMatchObject([{ key: "lead", pdf: "/books/Guide.pdf", page: 4, marks: [] }]);
    expect(spotsOf(run(undefined))).toEqual([]);
  });
});

describe("stepping and zooming", () => {
  test("next and previous stop at either end", () => {
    expect([stepSpot(5, 0, -1), stepSpot(5, 0, 1), stepSpot(5, 4, 1), stepSpot(5, 3, -1)]).toEqual([0, 1, 4, 2]);
  });

  test("zoom goes to the next step either way from wherever it is, and holds at the ends", () => {
    expect([zoomStep(1, 1), zoomStep(1, -1), zoomStep(1.1, 1), zoomStep(1.1, -1), zoomStep(3, 1), zoomStep(0.5, -1)]).toEqual([1.25, 0.75, 1.25, 1, 3, 0.5]);
  });

  test("a page is drawn at its width in device pixels, rounded up to a step, within the server's bounds", () => {
    expect([renderWidth(500, 1), renderWidth(500, 2), renderWidth(50, 1), renderWidth(3000, 2)]).toEqual([600, 1000, 200, 2000]);
  });
});

describe("laying out and placing", () => {
  const pages: [number, number][] = [
    [600, 800],
    [800, 600],
    [600, 800],
  ];

  test("stacks pages at the column's width, each as tall as its own shape makes it", () => {
    expect(layOut(pages, 300, 10)).toEqual({ tops: [0, 410, 645], heights: [400, 225, 400], total: 1045 });
  });

  test("finds the page holding a point of the column, gaps belonging to the page above", () => {
    const { tops } = layOut(pages, 300, 10);
    expect([pageAt(tops, 0), pageAt(tops, 405), pageAt(tops, 410), pageAt(tops, 2000), pageAt([], 5)]).toEqual([1, 1, 2, 3, 1]);
  });

  test("scales a mark by its page, so it lands on the same text at any size", () => {
    expect(placed({ page: 1, x0: 60, y0: 200, x1: 540, y1: 212 }, size)).toEqual({ left: 10, top: 25, width: 80, height: 1.5 });
  });

  test("scrolls a spot's first mark a third of the way down the view, or to its page's top when unmarked", () => {
    // The page starts 1000px down and is drawn 400px tall, half its 800pt height.
    expect(scrollFor({ marks: [mark(1, 400), mark(1, 200)] }, 1000, 400, size, 300)).toBe(1000 + 100 - 100);
    expect(scrollFor({ marks: [] }, 1000, 400, size, 300)).toBe(988);
  });

  test("the split follows the pointer, within its bounds", () => {
    expect([splitAt(600, 0, 1000), splitAt(100, 0, 1000), splitAt(950, 0, 1000)]).toEqual([0.4, 0.7, 0.3]);
  });
});
