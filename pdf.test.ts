import { describe, expect, test } from "bun:test";
import { outline, pageCount, pageScan, parseOutline, pageUrl, searchPdf, windows } from "./pdf";

const fixture = (name: string) => Bun.fileURLToPath(new URL(`fixture/${name}`, import.meta.url));
const manual = fixture("manual.pdf"); // three pages, one outline entry per page
const heart = fixture("heart.pdf"); // one page, no outline
const toc = fixture("toc.pdf"); // nested sections, a parent spanning pages

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

/**
 * A client that scores every title 3 and answers the "does this window hold
 * the answer" Noul with 1, so a walk visits sections in outline order and the
 * verifier alone decides where it stops. Keeps the walk testable offline.
 */
function stubClient() {
  return {
    systemOne: async ({ questions }: { questions: Record<string, unknown> }) => ({
      answers: Object.fromEntries(
        Object.entries(questions).map(([k, q]) => [
          k,
          (q as { type: string }).type === "noul"
            ? { type: "noul", noul: 1 }
            : { type: "score", score: 3, confidence: 1, legend: {}, probabilities: {} },
        ]),
      ),
    }),
  } as unknown as Parameters<typeof searchPdf>[0];
}

describe("searchPdf verification", () => {
  const base = { question: "q", threshold: 0.7, titleFloor: 0, max: 12, chars: 48000, batch: 40 };
  const ui = { log: () => {}, trying: () => {}, clear: () => {} };

  test("walks past a weak answer and takes a later strong one", async () => {
    const seen: string[] = [];
    const verify = async (section: string) => {
      seen.push(section);
      const ok = section.startsWith("Chapter III");
      return { text: ok ? "50" : "0", p: ok ? 0.9 : 0.3, verdict: ok ? ("take" as const) : ("keep" as const) };
    };
    const { hit, rejected } = await searchPdf(stubClient(), manual, { ...base, verify }, ui);
    expect(seen).toEqual(["Chapter I: Skills", "Chapter II: Perks", "Chapter III: Radiation"]);
    expect(hit?.section).toBe("Chapter III: Radiation");
    expect(hit?.answer).toEqual({ text: "50", p: 0.9 });
    expect(rejected).toHaveLength(2);
  });

  test("stops after maxAnswers windows and keeps them all as candidates", async () => {
    const verify = async () => ({ text: "0", p: 0.1, verdict: "keep" as const });
    const { hit, rejected } = await searchPdf(stubClient(), manual, { ...base, verify, maxAnswers: 2 }, ui);
    expect(hit).toBeUndefined();
    expect(rejected).toHaveLength(2);
  });

  test("a dropped answer is neither a hit nor a fallback, but is still reported", async () => {
    const verify = async () => ({ text: "not stated", p: 0.9, verdict: "drop" as const });
    const { hit, rejected, dropped } = await searchPdf(stubClient(), manual, { ...base, verify }, ui);
    expect(hit).toBeUndefined();
    expect(rejected).toEqual([]);
    expect(dropped.map((d) => d.hit.section)).toEqual(["Chapter I: Skills", "Chapter II: Perks", "Chapter III: Radiation"]);
  });

  test("a contents answer is taken without reading a page", async () => {
    const fromOutline = async () => ({ parent: "Chapter II: Perks", answer: { text: "3", p: 0.9 } });
    const { hit, tried } = await searchPdf(stubClient(), manual, { ...base, fromOutline }, ui);
    expect(hit?.answer).toEqual({ text: "3", p: 0.9 });
    expect(hit?.page).toBe(2);
    expect(tried).toEqual([]);
  });

  // The bug this guards: the contents said heretic is not a calling, and the
  // walk then read the classes page, which said true.
  test("a contents pointer confines the walk to that section, ignoring the title floor", async () => {
    const seen: string[] = [];
    const verify = async (section: string) => {
      seen.push(section);
      return { text: "false", p: 0.9, verdict: "take" as const };
    };
    const fromOutline = async () => ({ parent: "Chapter II: Perks" });
    const { hit } = await searchPdf(stubClient(), manual, { ...base, titleFloor: 99, verify, fromOutline }, ui);
    expect(seen).toEqual(["Chapter II: Perks"]);
    expect(hit?.section).toBe("Chapter II: Perks");
  });

  test("without a verifier the first window wins, as a passage question wants", async () => {
    const { hit, rejected } = await searchPdf(stubClient(), manual, base, ui);
    expect(hit?.section).toBe("Chapter I: Skills");
    expect(hit?.answer).toBeUndefined();
    expect(rejected).toEqual([]);
  });
});

describe("a section-wide count", () => {
  const base = { question: "q", threshold: 0.7, titleFloor: -Infinity, max: 12, chars: 400, batch: 40 };
  const ui = { log: () => {}, trying: () => {}, clear: () => {} };

  test("spends its descendants, which could only re-count its pages", async () => {
    const counted: string[] = [];
    const { rejected } = await searchPdf(
      stubClient(),
      toc,
      {
        ...base,
        countAcross: async (section, windows) => {
          counted.push(section);
          return { text: String(windows.length), p: 0.1, verdict: "keep" };
        },
        verify: async (section) => {
          counted.push(section);
          return { text: "1", p: 0.1, verdict: "keep" };
        },
      },
      ui,
    );
    const wide = counted[0]!;
    expect(counted.filter((c) => c.startsWith(`${wide} > `))).toEqual([]);
    expect(rejected[0]!.scope).toBeGreaterThan(1);
  });

  test("records scope 1 for a window read on its own", async () => {
    const { rejected } = await searchPdf(
      stubClient(),
      manual,
      { ...base, chars: 48000, verify: async () => ({ text: "1", p: 0.1, verdict: "keep" }) },
      ui,
    );
    expect(rejected[0]!.scope).toBe(1);
  });
});
