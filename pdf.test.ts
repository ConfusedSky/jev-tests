import { describe, expect, test } from "bun:test";
import { batches, outline, pageCount, pageScan, parseOutline, pageUrl, searchPdf, windows } from "./pdf";

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
function stubClient(scoreOf: (title: string) => number = () => 3) {
  return {
    systemOne: async ({ questions }: { questions: Record<string, unknown> }) => ({
      answers: Object.fromEntries(
        Object.entries(questions).map(([k, q]) => {
          const { type, instructions } = q as { type: string; instructions: string };
          if (type === "noul") return [k, { type, noul: 1 }];
          const title = /\("(.*)"\) answers/.exec(instructions)?.[1] ?? "";
          return [k, { type, score: scoreOf(title), confidence: 1, legend: {}, probabilities: {} }];
        }),
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

describe("a soft title floor", () => {
  const ui = { log: () => {}, trying: () => {}, clear: () => {} };
  const base = { question: "q", threshold: 0.7, titleFloor: 1, max: 12, chars: 48000, batch: 40 };
  const onlyFirst = (t: string) => (t === "Chapter I: Skills" ? 3 : 0);

  test("reads below the floor while nothing has answered", async () => {
    const seen: string[] = [];
    const verify = async (section: string) => {
      seen.push(section);
      return { text: "0", p: 0.1, verdict: "keep" as const };
    };
    await searchPdf(stubClient(onlyFirst), manual, { ...base, verify }, ui);
    expect(seen).toEqual(["Chapter I: Skills", "Chapter II: Perks", "Chapter III: Radiation"]);
  });

  // Above the floor -n windows are collected; below it one is enough. The
  // check has to fire at the loop head, before a below-floor section is read:
  // with -n 2 and one hit above the floor, Chapter II must not be opened.
  test("stops at the floor once anything has answered, even short of -n", async () => {
    const seen: string[] = [];
    const verify = async (section: string) => {
      seen.push(section);
      return { text: "1", p: 0.9, verdict: "take" as const };
    };
    const { hits } = await searchPdf(stubClient(onlyFirst), manual, { ...base, verify, hits: 2 }, ui);
    expect(seen).toEqual(["Chapter I: Skills"]);
    expect(hits).toHaveLength(1);
  });

  test("collects -n above the floor", async () => {
    const seen: string[] = [];
    const verify = async (section: string) => {
      seen.push(section);
      return { text: "1", p: 0.9, verdict: "take" as const };
    };
    const firstTwo = (t: string) => (t.startsWith("Chapter III") ? 0 : 3);
    const { hits } = await searchPdf(stubClient(firstTwo), manual, { ...base, verify, hits: 3 }, ui);
    expect(seen).toEqual(["Chapter I: Skills", "Chapter II: Perks"]);
    expect(hits).toHaveLength(2);
  });

  test("--max still bounds the walk below the floor", async () => {
    const seen: string[] = [];
    const verify = async (section: string) => {
      seen.push(section);
      return { text: "0", p: 0.1, verdict: "keep" as const };
    };
    await searchPdf(stubClient(onlyFirst), manual, { ...base, verify, max: 2 }, ui);
    expect(seen).toHaveLength(2);
  });
});

describe("several hits", () => {
  const ui = { log: () => {}, trying: () => {}, clear: () => {} };
  const base = { question: "q", threshold: 0.7, titleFloor: 0, max: 12, chars: 48000, batch: 40 };

  test("keeps walking until enough windows have passed, then stops", async () => {
    const { hit, hits, tried } = await searchPdf(stubClient(), manual, { ...base, hits: 2 }, ui);
    expect(hits.map((h) => h.section)).toEqual(["Chapter I: Skills", "Chapter II: Perks"]);
    expect(hit?.section).toBe("Chapter I: Skills");
    expect(tried).toHaveLength(2);
  });

  test("returns what it found when the book runs out first", async () => {
    const { hits } = await searchPdf(stubClient(), manual, { ...base, hits: 5 }, ui);
    expect(hits).toHaveLength(3);
  });

  test("one hit by default", async () => {
    const { hits } = await searchPdf(stubClient(), manual, base, ui);
    expect(hits).toHaveLength(1);
  });
});

describe("a section-wide count", () => {
  const base = { question: "q", threshold: 0.7, titleFloor: 1, max: 12, chars: 400, batch: 40 };
  const ui = { log: () => {}, trying: () => {}, clear: () => {} };
  const keep = (text: string) => ({ text, p: 0.1, verdict: "keep" as const });
  const countAcross = async (section: string, windows: unknown[]) => keep(`${section}:${windows.length}`);

  test("spends its descendants, which could only re-count its pages", async () => {
    const seen: string[] = [];
    const verify = async (section: string) => {
      seen.push(section);
      return keep("1");
    };
    const { rejected } = await searchPdf(stubClient(), toc, { ...base, countAcross, verify }, ui);
    expect(rejected.map((c) => c.hit.section)).toContain("Characters");
    expect(seen.filter((c) => c.startsWith("Characters > "))).toEqual([]);
  });

  // The bug this guards: 5 off one perk's page outranked 78 for the whole
  // section, because the fragment was more confident.
  test("drops a fragment counted earlier once the whole section is counted", async () => {
    const byTitle = (t: string) => (t === "Characters > Classes > Witch" ? 3 : t === "Characters" ? 2 : 0);
    const verify = async () => keep("1");
    const { rejected, dropped } = await searchPdf(stubClient(byTitle), toc, { ...base, countAcross, verify }, ui);
    expect(rejected.map((c) => c.hit.section)).toEqual(["Characters"]);
    expect(dropped.map((c) => c.hit.section)).toEqual(["Characters > Classes > Witch"]);
  });
});

describe("batches", () => {
  const page = (n: number, len: number) => ({ page: n, text: "x".repeat(len) });

  test("packs pages up to the limit, in order", () => {
    const out = batches([page(1, 40), page(2, 40), page(3, 40), page(4, 40)], 100);
    expect(out.map((b) => b.map((w) => w.page))).toEqual([[1, 2], [3, 4]]);
  });

  test("a page over the limit travels alone", () => {
    const out = batches([page(1, 10), page(2, 500), page(3, 10)], 100);
    expect(out.map((b) => b.map((w) => w.page))).toEqual([[1], [2], [3]]);
  });

  test("no pages, no batches", () => {
    expect(batches([], 100)).toEqual([]);
  });
});

describe("per page", () => {
  const ui = { log: () => {}, trying: () => {}, clear: () => {} };

  test("gates a section's pages in one call, not one per page", async () => {
    let calls = 0;
    const inner = stubClient((t) => (t === "Characters" ? 3 : 0));
    const counting = { systemOne: async (r: never) => (calls++, inner.systemOne(r)) } as unknown as typeof inner;
    const opts = { question: "q", threshold: 0.7, titleFloor: 1, max: 12, chars: 48000, batch: 40, perPage: true };
    const { tried } = await searchPdf(counting, toc, opts, ui);
    expect(tried.map((t) => t.page)).toEqual([2, 3]);
    expect(calls).toBe(2); // one to rank the titles, one to gate both pages
  });

  // The fallback for a PDF without an outline used to gate the whole book in
  // one go; a batch is a whole window's worth of pages, and the walk stops at
  // the first batch that answers, as it does with whole windows.
  test("gates the pages of a long scan a batch at a time and stops at the first that answers", async () => {
    const opts = { question: "q", threshold: 0.7, titleFloor: 1, max: 12, chars: 5000, batch: 40, perPage: true };
    const { hit, tried } = await searchPdf(stubClient(), fixture("catalogue.pdf"), opts, ui);
    expect(hit?.page).toBe(1);
    expect(tried.length).toBeGreaterThan(1);
    expect(tried.length).toBeLessThan(24);
  });

  test("a chars of 0 puts every page in its own window", async () => {
    const ws = await windows(manual, { path: "", start: 1, end: 3 }, 0);
    expect(ws.map((w) => w.page)).toEqual([1, 2, 3]);
  });

  test("the hit names the page that answered, not the first of the section", async () => {
    const opts = { question: "q", threshold: 0.7, titleFloor: 1, max: 12, chars: 48000, batch: 40 };
    const only = (t: string) => (t === "Characters" ? 3 : 0);
    const onPage = async (_s: string, page: number) => ({ text: "x", p: 0.9, verdict: page === 3 ? ("take" as const) : ("keep" as const) });
    // max 1 keeps the soft floor from walking on to the Classes section, which starts on page 3.
    const whole = await searchPdf(stubClient(only), toc, { ...opts, max: 1, verify: onPage }, ui);
    expect(whole.hit).toBeUndefined();
    const paged = await searchPdf(stubClient(only), toc, { ...opts, max: 1, perPage: true, verify: onPage }, ui);
    expect(paged.hit?.page).toBe(3);
  });
});
