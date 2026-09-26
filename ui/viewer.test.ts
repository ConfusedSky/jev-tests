import { describe, expect, test } from "bun:test";
import { parseLine } from "./log";
import type { Run } from "./run";
import type { JsonHit, JsonReport } from "./types";
import { anchorAt, layOut, markAnchor, pageAt, pageInput, placed, renderWidth, scrollFor, scrollOf, splitAt, spotsOf, stepSpot, zoomStep } from "./viewer";

const spent = { in: 0, out: 0, dollars: 0, ms: { total: 0, jev: 0, read: 0, stdin: 0, embed: 0, highlight: 0, sizes: 0, other: 0 } };
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
  sizes: {},
  ...extra,
});

describe("spotsOf", () => {
  test("lists each hit's marked pages in page order, passages in different books included", () => {
    const hits = [
      hit("/a.pdf", 12, { marks: [mark(13, 100), mark(12, 700), mark(12, 712)], sizes: { 12: size, 13: size } }),
      hit("/b.pdf", 3, { marks: [mark(3, 40)], sizes: { 3: size } }),
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
    const { marks, sizes, ...old } = hit("/a.pdf", 7);
    const saved = spotsOf(run({ kind: "passage", status: "answered", hits: [old as JsonHit], spent }));
    expect(saved).toMatchObject([{ page: 7, marks: [], unmarked: "this run was saved before highlights were kept with each run" }]);
  });

  test("reads the page sizes of a run saved while they were called pages, never the answer's own list of pages", () => {
    const { sizes, ...rest } = hit("/a.pdf", 12, { marks: [mark(12, 100)], answer: { text: "9", p: 1, pages: [12] } });
    const saved = { ...rest, pages: { 12: size } } as unknown as JsonHit;
    expect(spotsOf(run({ kind: "count", status: "answered", hits: [saved], spent }))[0]!.size).toEqual(size);
    const listed = { ...rest, pages: [12] } as unknown as JsonHit;
    expect(spotsOf(run({ kind: "count", status: "answered", hits: [listed], spent }))[0]!.size).toBeUndefined();
  });

  test("shows a section's title without the object replacement character an outline can carry", () => {
    const h = hit("/a.pdf", 46, { section: "Skills > \uFFFC Skill Or\u200B Trade", marks: [mark(46, 100)] });
    expect(spotsOf(run({ kind: "passage", status: "answered", hits: [h], spent }))[0]!.section).toBe("Skills > Skill Or Trade");
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

  test("a typed page goes there, held to the last page; nothing typed, or no page, goes nowhere", () => {
    expect([pageInput("2", 3), pageInput("9", 3), pageInput("", 3), pageInput(undefined, 3), pageInput("0", 3), pageInput(" ", 3), pageInput("2", 0)]).toEqual([2, 3, undefined, undefined, undefined, undefined, undefined]);
  });

  test("the split follows the pointer, within its bounds", () => {
    expect([splitAt(600, 0, 1000), splitAt(100, 0, 1000), splitAt(950, 0, 1000)]).toEqual([0.4, 0.7, 0.3]);
  });
});

describe("holding the view while the pages change size", () => {
  const pages: [number, number][] = [
    [600, 800],
    [600, 800],
    [600, 800],
  ];
  const laid = (width: number) => ({ lay: layOut(pages, width, 12), width, pad: 16 });
  const view = { left: 0, top: 0, width: 400, height: 600 };

  test("a point under the view stays under the same place of it at any zoom", () => {
    // Fit to a 400px view: pages 368px wide, 490.67px tall; the view's middle is on page 2.
    const at = { ...view, top: 700 };
    const a = anchorAt(laid(368), at, 0.5, 0.5);
    expect(a.page).toBe(2);
    const to = scrollOf(a, laid(368 * 3), view.width, view.height);
    // The same point of page 2, now three times as far down and across, stands at the view's middle again.
    const [x, y] = [16 + a.fx * 368 * 3 - to.left, 16 + layOut(pages, 368 * 3, 12).tops[1]! + a.fy * layOut(pages, 368 * 3, 12).heights[1]! - to.top];
    expect([Math.round(x), Math.round(y)]).toEqual([200, 300]);
    // Unzoomed, it comes back to where it was.
    const back = scrollOf(a, laid(368), view.width, view.height);
    expect([back.left, back.top].map(Math.round)).toEqual([0, 700]);
  });

  test("zooming holds on a highlight too wide for the view by its top left, brought in from the view's lower half", () => {
    const spot = { page: 1, marks: [mark(1, 700)] };
    // Page 1 fills the view from its top; the mark, 7/8 of the way down, is near the view's bottom.
    const a = markAnchor(spot, size, laid(368), { ...view, height: 500 }, 3)!;
    expect([a.page, a.fx, a.fy, a.vy]).toEqual([1, 0.1, 0.875, 0.5]);
    const at3 = scrollOf(a, laid(368 * 3), view.width, 500);
    const y = 16 + 0.875 * layOut(pages, 368 * 3, 12).heights[0]! - at3.top;
    expect(y).toBeCloseTo(250, 6);
  });

  test("zooming holds on the view's middle when the highlight's page is out of view or nothing is marked", () => {
    expect(markAnchor({ page: 3, marks: [mark(3, 100)] }, size, laid(368), view)).toBeUndefined();
    expect(markAnchor({ page: 1, marks: [] }, size, laid(368), view)).toBeUndefined();
  });

  // The page is in view, the mark is not: holding it would pull the view back to it.
  test("zooming holds on the view's middle when the highlight's page is in view but none of its marks", () => {
    const spot = { page: 1, marks: [mark(1, 100)] };
    // At 300% page 1 is 1472px tall; its mark stands 200px down, the view 700px below that.
    const at3 = laid(368 * 3);
    expect(markAnchor(spot, size, at3, { ...view, top: 900 }, 1 / 3)).toBeUndefined();
    expect(markAnchor(spot, size, at3, { ...view, top: 0 }, 1 / 3)).toBeDefined();
    // Nor when the page, wider than the view, is scrolled across past it.
    const aside = { page: 1, marks: [{ page: 1, x0: 500, y0: 100, x1: 540, y1: 112 }] };
    expect(markAnchor(aside, size, at3, { ...view, top: 0 }, 1 / 3)).toBeUndefined();
  });

  // A row's cells toward the right of the page: held by the first, the last went off the view's edge at 300%.
  test("zooming holds on a highlight that will fit the view by its middle, all of it kept in view", () => {
    const cell = (x0: number) => ({ page: 1, x0, y0: 400, x1: x0 + 15, y1: 412 });
    const spot = { page: 1, marks: [cell(400), cell(450), cell(500)] };
    const a = markAnchor(spot, size, laid(368), view, 3)!;
    expect(a.fx).toBeCloseTo(457.5 / 600, 9);
    expect(a.fy).toBeCloseTo(406 / 800, 9);
    const at3 = laid(368 * 3);
    const to = scrollOf(a, at3, view.width, view.height);
    const box = (m: ReturnType<typeof cell>) => [16 + (m.x0 / 600) * 1104 - to.left, 16 + (m.y0 / 800) * at3.lay.heights[0]! - to.top, 16 + (m.x1 / 600) * 1104 - to.left, 16 + (m.y1 / 800) * at3.lay.heights[0]! - to.top];
    for (const m of spot.marks) {
      const [x0, y0, x1, y1] = box(m);
      expect(x0).toBeGreaterThanOrEqual(0);
      expect(y0).toBeGreaterThanOrEqual(0);
      expect(x1).toBeLessThanOrEqual(view.width);
      expect(y1).toBeLessThanOrEqual(view.height);
    }
    // Where it fits already, it stays where it stands.
    const still = markAnchor(spot, size, laid(368), view, 1)!;
    expect(still.vx).toBeCloseTo((16 + (457.5 / 600) * 368) / 400, 9);
  });
});
