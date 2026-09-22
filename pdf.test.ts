import { describe, expect, test } from "bun:test";
import { outline, pageCount, pageScan, parseOutline, pageUrl, windows } from "./pdf";

const fixture = (name: string) => Bun.fileURLToPath(new URL(`fixture/${name}`, import.meta.url));
const manual = fixture("manual.pdf"); // three pages, one outline entry per page
const heart = fixture("heart.pdf"); // one page, no outline

describe("parseOutline", () => {
  test("reads path, start and end from each line", () => {
    expect(parseOutline("Chapter I\t1\t4\nChapter II\t5\t9\n")).toEqual([
      { path: "Chapter I", start: 1, end: 4 },
      { path: "Chapter II", start: 5, end: 9 },
    ]);
  });

  test("drops entries whose destination did not resolve", () => {
    expect(parseOutline("Bad\tnull\tnull\nGood\t2\t3")).toEqual([{ path: "Good", start: 2, end: 3 }]);
  });

  test("a title containing a newline loses everything before the break", () => {
    // Why outline.js collapses whitespace in titles: the leading fragment
    // becomes a fieldless line and the entry survives under a truncated name.
    expect(parseOutline("Chapter\nI\t1\t4")).toEqual([{ path: "I", start: 1, end: 4 }]);
  });

  test("no outline yields no sections rather than throwing", () => {
    expect(parseOutline("")).toEqual([]);
  });
});

describe("outline", () => {
  test("extracts an entry per bookmark with its page range", async () => {
    expect(await outline(manual)).toEqual([
      { path: "Chapter I: Skills", start: 1, end: 1 },
      { path: "Chapter II: Perks", start: 2, end: 2 },
      { path: "Chapter III: Radiation", start: 3, end: 3 },
    ]);
  });

  test("a PDF without bookmarks reports no sections", async () => {
    expect(await outline(heart)).toEqual([]);
  });
});

describe("windows", () => {
  test("a section that fits stays one window tagged with its first page", async () => {
    const ws = await windows(manual, { path: "", start: 2, end: 2 }, 48000);
    expect(ws).toHaveLength(1);
    expect(ws[0]!.page).toBe(2);
    expect(ws[0]!.text).toContain("Gunslinger");
  });

  test("splits on page boundaries once a window would overflow", async () => {
    const ws = await windows(manual, { path: "", start: 1, end: 3 }, 200);
    expect(ws.length).toBeGreaterThan(1);
    expect(ws.map((w) => w.page)).toEqual([...ws.map((w) => w.page)].sort((a, b) => a - b));
    expect(ws[0]!.page).toBe(1);
  });

  test("window pages are absolute, not relative to the section", async () => {
    const ws = await windows(manual, { path: "", start: 3, end: 3 }, 48000);
    expect(ws[0]!.page).toBe(3);
    expect(ws[0]!.text).toContain("RadAway");
  });

  test("drops a window holding less text than a call is worth", async () => {
    // The title page carries only its heading, well under the 200-char floor.
    const ws = await windows(fixture("title-only.pdf"), { path: "", start: 1, end: 1 }, 48000);
    expect(ws).toEqual([]);
  });
});

describe("pageScan", () => {
  test("covers the whole document when there is no outline", async () => {
    expect(await pageCount(heart)).toBe(1);
    const ws = await pageScan(heart, 48000);
    expect(ws).toHaveLength(1);
    expect(ws[0]!.page).toBe(1);
    expect(ws[0]!.text).toContain("Vermissian Knight");
  });

  test("starts at page one and stays in order", async () => {
    const ws = await pageScan(manual, 200);
    expect(ws[0]!.page).toBe(1);
    expect(ws.at(-1)!.page).toBeLessThanOrEqual(await pageCount(manual));
  });
});

describe("pageUrl", () => {
  test("carries the page as a fragment", () => {
    expect(pageUrl("/tmp/a b.pdf", 12)).toBe("file:///tmp/a%20b.pdf#page=12");
  });
});
