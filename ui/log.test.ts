import { describe, expect, test } from "bun:test";
import { drain, factsOf, isTotal, parseLine, spendOf, tree, withoutCost } from "./log";

const LOG = `question looks like a count question  in 0.4s (jev 0.4s, read 0.0s, other 0.0s; 2,642 tokens in, 614 out, $0.00011)
counts skills
searches for skills, vault dweller
ranked 3 sections and 0 excerpts in 0.2s (jev 0.2s, read 0.0s, other 0.0s; 561 tokens in, 52 out, $0.00002), 1 above title floor 1 (2 below)
section Chapter I: Skills  p.1-1…
  gated 1 pages (batch 1/1), 0.2s jev, 1 yes  Chapter I: Skills
  yes  0.85  Chapter I: Skills p.1
  take  7 (p=1.00)  Chapter I: Skills p.1
section 0.5s (jev 0.5s, read 0.0s, other 0.0s; 2,898 tokens in, 287 out, $0.00012)  Chapter I: Skills
total 1.1s (jev 1.1s, read 0.0s, other 0.0s; 6,101 tokens in, 953 out, $0.00026)`.split("\n");

const lines = LOG.map((l, i) => parseLine(l, i));

describe("parseLine", () => {
  test("reads depth, verdict, cost and time", () => {
    expect(lines[7]).toMatchObject({ depth: 1, verb: "take", text: "take  7 (p=1.00)  Chapter I: Skills p.1" });
    expect(lines[8]).toMatchObject({ depth: 0, verb: "section", cost: { in: 2898, out: 287, dollars: 0.00012 }, secs: 0.5 });
    expect(lines[4]!.header).toBe(true);
  });

  test("takes yes and no as verdicts only before a probability", () => {
    expect(parseLine("  no   0.04  Equipment p.99").verb).toBe("no");
    expect(parseLine("no outline: scanning 1 of 1 windows in page order…").verb).toBeUndefined();
    expect(parseLine("  --  no outline and no extractable text  a.pdf").verb).toBe("--");
  });

  test("marks a tool's own message", () => {
    expect(parseLine("jevsec: no answer reached p=0.7 in 2 windows; best follows").message).toBe(true);
  });
});

describe("tree", () => {
  test("puts a step's lines under its header and its sum beside it", () => {
    const t = tree(lines);
    expect(t.map((n) => n.index)).toEqual([0, 1, 2, 3, 4, 9]);
    expect(t[4]!.children.map((n) => n.index)).toEqual([5, 6, 7]);
    expect(t[4]!.sum?.text).toStartWith("section 0.5s");
  });
});

describe("spendOf", () => {
  test("is the total once there is one", () => {
    expect(spendOf(lines).in).toBe(6101);
  });

  // Mid-run a sum replaces the lines it sums, so nothing counts twice.
  test("counts a sum in place of the lines under it", () => {
    const partial = [
      parseLine("a  in 0.1s (jev 0.1s, read 0.0s, other 0.0s; 100 tokens in, 1 out, $0.00001)"),
      parseLine("b…"),
      parseLine("  c  in 0.1s (jev 0.1s, read 0.0s, other 0.0s; 10 tokens in, 1 out, $0.00001)"),
      parseLine("  d  in 0.1s (jev 0.1s, read 0.0s, other 0.0s; 20 tokens in, 1 out, $0.00001)"),
    ];
    expect(spendOf(partial).in).toBe(130);
    partial.push(parseLine("b 0.2s (jev 0.2s, read 0.0s, other 0.0s; 30 tokens in, 2 out, $0.00001)"));
    expect(spendOf(partial).in).toBe(130);
  });

  // An unanswered run ends on the tool's message, which counts since the start; older logs have no total before it.
  test("takes the tool's closing message as the whole, not as one more part", () => {
    const unanswered = [
      parseLine("question looks like a passage question  in 0.1s (jev 0.1s, read 0.0s, other 0.0s; 100 tokens in, 1 out, $0.00001)"),
      parseLine("section A  p.1-1…"),
      parseLine("  no   0.04  A p.1"),
      parseLine("section 0.1s (jev 0.1s, read 0.0s, other 0.0s; 200 tokens in, 1 out, $0.00001)  A"),
      parseLine("jevsec: none of 1 windows reached p=0.7 in 0.3s (jev 0.2s, read 0.1s, other 0.0s; 300 tokens in, 2 out, $0.00001); best was 0.04 at A p.1"),
    ];
    expect(isTotal(unanswered[4]!)).toBe(true);
    expect(spendOf(unanswered).in).toBe(300);
    expect(spendOf([...unanswered.slice(0, 4), parseLine("total 0.3s (jev 0.2s, read 0.1s, other 0.0s; 300 tokens in, 2 out, $0.00001)"), unanswered[4]!]).in).toBe(300);
    expect(isTotal(parseLine("jevsec: no answer reached p=0.7 in 2 windows; best follows"))).toBe(false);
  });
});

describe("factsOf", () => {
  test("reads what jev made of the question", () => {
    expect(factsOf(lines)).toMatchObject({ kind: "count", forced: false, counts: "skills", searches: "skills, vault dweller", sections: 1 });
  });

  test("reads the question's own kind, not a cell's", () => {
    const f = factsOf([parseLine("question looks like a table question  in 0.4s (jev 0.4s, read 0.0s, other 0.0s)"), parseLine("  question looks like a count question  in 0.3s (jev 0.3s, read 0.0s, other 0.0s)")]);
    expect(f.kind).toBe("table");
  });

  test("reads a ranking taken from the cache and a shelf walk's totals", () => {
    const f = factsOf([
      parseLine(`  ranked from cache in 3.8s (jev 0.0s, read 0.0s, other 3.8s): "How is radiation treated?" (question 0.53, subject 0.85)`),
      parseLine("total 52.1s (jev 1.8s, read 0.2s, stdin 50.1s, other 0.0s), 1 files opened, 2 windows read"),
    ]);
    expect(f.cache).toEqual({ question: "How is radiation treated?", score: "question 0.53, subject 0.85", count: 1 });
    expect([f.files, f.windows]).toEqual([1, 2]);
  });

  // A cell of a table across the shelf ranks its files two levels down; its cache hits are not the question's.
  test("leaves a cell's cached ranking to the cell", () => {
    const line = `ranked from cache in 0.1s (jev 0.0s, read 0.0s, other 0.1s): "q" (question 0.9, subject 0.9)`;
    expect(factsOf([parseLine(`    ${line}`)]).cache).toBeUndefined();
    expect(factsOf([parseLine(`  ${line}`)]).cache?.count).toBe(1);
  });

  test("keeps what the contents answered, so a hit matching it is known to be read off them", () => {
    const f = factsOf([parseLine("  toc   9 (p=0.98)  Classes  in 0.4s (jev 0.4s, read 0.0s, other 0.0s; 1,200 tokens in, 20 out, $0.00005)"), parseLine("toc   reading Gear (4 sections)  in 0.2s (jev 0.2s, read 0.0s, other 0.0s)")]);
    expect(f.toc).toEqual([{ text: "9", section: "Classes" }]);
  });

  test("counts the sections one file's walk took up, skipped ones included, and a scan of a book without an outline", () => {
    const shelf = [
      "ranked 3 paths and 0 excerpts in 0.1s (jev 0.1s, read 0.0s, other 0.0s; 100 tokens in, 1 out, $0.00001), 1 above file floor 1.5 (2 below)",
      "2.10  /a.pdf…",
      "  ranked 6 sections and 0 excerpts in 0.1s (jev 0.1s, read 0.0s, other 0.0s; 100 tokens in, 1 out, $0.00001), 2 above title floor 1 (4 below)",
      "  section A  p.1-1…",
      "    no   0.04  A p.1",
      "  section 0.1s (jev 0.1s, read 0.0s, other 0.0s; 10 tokens in, 1 out, $0.00001)  A",
      "    --    B  already counted under A",
      "file 0.3s (jev 0.2s, read 0.1s, other 0.0s; 210 tokens in, 2 out, $0.00001)  1 windows read",
      "1.20  /b.pdf…",
      "  section C  p.1-1…",
      "  section 0.1s (jev 0.1s, read 0.0s, other 0.0s; 10 tokens in, 1 out, $0.00001)  C",
      "  no outline: scanning 12 of 40 windows in page order…",
    ].map((l) => parseLine(l));
    const f = factsOf(shelf);
    expect(f.mostSections).toBe(2);
    expect(f.sections).toBe(2);
    expect(f.scan).toEqual({ read: 12, of: 40 });
    expect([f.titleBelow, f.filesBelow]).toEqual([4, 2]);
  });
});

describe("withoutCost", () => {
  test("drops the time and tokens clause wherever the line puts it", () => {
    expect(withoutCost("counts done  in 0.4s (jev 0.4s, read 0.0s, other 0.0s; 2,642 tokens in, 614 out, $0.00011)")).toBe("counts done");
    expect(withoutCost("total 3.5s (jev 0.9s, read 0.0s, other 2.5s; 6,861 tokens in, 1,049 out, $0.00029), 1 files opened")).toBe("total 1 files opened");
    expect(withoutCost("jevsec: none of 3 windows reached p=0.7 in 0.7s (jev 0.6s, read 0.1s, other 0.0s; 1,336 tokens in, 114 out, $0.00006); best was 0.15 at Guns p.1")).toBe(
      "jevsec: none of 3 windows reached p=0.7; best was 0.15 at Guns p.1",
    );
  });
});

describe("drain", () => {
  test("splits log lines from \\r-ended progress, dropping escapes, and keeps the unended rest", () => {
    const out: { type: string; line: string }[] = [];
    const rest = drain("\u001b[2Ksection A  p.1-1…\n\u001b[2m  … A 1 pages (batch 1/1)\u001b[0m\r\u001b[2K  gated 1 pages\nhalf", (e) => out.push(e));
    expect(out).toEqual([
      { type: "log", line: "section A  p.1-1…" },
      { type: "trying", line: "A 1 pages (batch 1/1)" },
      { type: "log", line: "  gated 1 pages" },
    ]);
    expect(rest).toBe("half");
  });
});
