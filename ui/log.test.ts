import { describe, expect, test } from "bun:test";
import { columnsOf, drain, errorText, factsOf, flowOf, gaugesOf, isFrame, isTotal, parseLine, spendOf, stateOf, tree, walkOf, withoutCost } from "./log";

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
    expect(f.cache).toEqual({ question: "How is radiation treated?", score: "question 0.53, subject 0.85", whole: 0.53, subject: 0.85, count: 1 });
    expect(factsOf([parseLine(`ranked from cache in 0.1s (jev 0.0s): "q" (question 0.61, subject –)`)]).cache).toMatchObject({ whole: 0.61, subject: undefined });
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

describe("factsOf excerpts", () => {
  test("counts the excerpt pages gated, passed or not, apart from the sections", () => {
    const f = factsOf(
      [
        "section Rules  p.1-2…",
        "section 0.5s (jev 0.5s; 10 tokens in, 1 out, $0.00001)  Rules",
        "excerpts: gated 2 pages (1 batch)  in 0.2s (jev 0.2s; 10 tokens in, 1 out, $0.00001)",
        "excerpt  no   0.10  Rules p.7 (excerpt)",
        "excerpt  yes  0.90  Rules p.9 (excerpt)…",
        "excerpt 0.3s (jev 0.3s; 10 tokens in, 1 out, $0.00001)  Rules p.9 (excerpt)",
      ].map((l) => parseLine(l)),
    );
    expect(f.excerpts).toBe(2);
    expect(f.sections).toBe(1);
  });
});

describe("walkOf and flowOf", () => {
  const parse = (log: string) => log.split("\n").map((l) => parseLine(l));

  test("follow a shelf walk from the paths ranked to the page taken", () => {
    const w = walkOf(
      parse(`question looks like a passage question  in 0.2s (jev 0.2s; 3,169 tokens in, 751 out, $0.00013)
ranked 25 paths and 23 excerpts in 0.5s (jev 0.4s; 8,044 tokens in, 796 out, $0.00034), 1 above file floor 1.5 (24 below)
2.70  /books/Guide.pdf…
  ranked 169 sections and 20 excerpts in 0.5s (jev 0.3s; 27,803 tokens in, 3,174 out, $0.00117), 60 above title floor 1 (109 below)
  section Part I > Getting Started  p.136-137…
    gated 2 pages (batch 1/1), 0.2s jev, 2 yes  Part I > Getting Started
    yes  0.78  Part I > Getting Started p.136 (window 1/2)
    yes  0.76  Part I > Getting Started p.137 (window 2/2)
    take  Open the box… (p=0.76)  Part I > Getting Started p.136 (window 1/2)
  section 1.8s (jev 0.7s; 9,068 tokens in, 720 out, $0.00038)  Part I > Getting Started
file 2.3s (jev 1.0s; 36,871 tokens in, 3,894 out, $0.00155)  2 windows read
total 3.0s (jev 1.6s; 48,084 tokens in, 5,441 out, $0.00202), 1 files opened, 2 windows read`),
    );
    expect(w.paths).toEqual({ ranked: 25, above: 1, floor: "1.5", times: 1 });
    expect(w.files).toEqual([
      { path: "/books/Guide.pdf", score: 2.7, ranked: "169 sections and 20 excerpts", reads: [{ kind: "section", name: "Part I > Getting Started p.136-137", p: 0.78, gate: "yes", verdict: "take", answer: "Open the box…", sure: 0.76, page: 136 }] },
    ]);
    expect(flowOf(w)).toEqual(["ranked 25 paths", "opened 1 of 25 (1 above the file floor 1.5)", "read 1 section", "took p.136"]);
  });

  test("count excerpt pages, a cached ranking and a page read off the contents", () => {
    const w = walkOf(
      parse(`ranked from cache in 0.1s (jev 0.0s; embed 0.1s): "How much does it cost?" (question 0.78, subject 1.00)
excerpts: gated 7 pages (1 batch)  in 0.3s (jev 0.3s; 2,946 tokens in, 143 out, $0.00012)
excerpt  no   0.10  Catalogue p.20 (excerpt)
excerpt  yes  0.99  Catalogue p.24 (excerpt)…
  take  410 (p=1.00)  Catalogue p.24 (excerpt)
excerpt 0.3s (jev 0.2s; 1,593 tokens in, 168 out, $0.00007)  Catalogue p.24 (excerpt)`),
    );
    expect(w.files[0]!.reads).toEqual([
      { kind: "excerpt", name: "Catalogue p.20", p: 0.1, gate: "no" },
      { kind: "excerpt", name: "Catalogue p.24", p: 0.99, gate: "yes", verdict: "take", answer: "410", sure: 1, page: 24 },
    ]);
    expect(flowOf(w)).toEqual(["ranked from the cache", "read 2 excerpt pages", "took p.24"]);
    // A PDF without an outline names an excerpt by its page twice over.
    expect(walkOf(parse("excerpt  yes  0.98  p.1 p.1 (excerpt)…")).files[0]!.reads[0]!.name).toBe("p.1");
    const toc = walkOf(parse("toc   9 (p=1.00)  Characters > Classes  in 0.1s (jev 0.1s; 767 tokens in, 111 out, $0.00003)"));
    expect(flowOf(toc)).toEqual(["read the contents", "took the contents"]);
  });

  test("take the windows of a PDF without an outline, and say when nothing was taken", () => {
    const w = walkOf(
      parse(`ranked 0 sections and 0 excerpts in 0.1s (jev 0.1s; 10 tokens in, 1 out, $0.00001), 0 above title floor 1
no outline: scanning 2 of 2 windows in page order…
  no   0.20  p.1
  no   0.10  p.2
no outline 0.4s (jev 0.4s; 900 tokens in, 20 out, $0.00004)`),
    );
    expect(w.files[0]!.reads.map((r) => [r.kind, r.name, r.p])).toEqual([
      ["window", "p.1", 0.2],
      ["window", "p.2", 0.1],
    ]);
    expect(flowOf(w)).toEqual(["ranked 0 sections", "read 2 windows", "took nothing"]);
    expect(flowOf(walkOf(parse("ranked 9 names in 0.3s (jev 0.3s; 1,317 tokens in, 148 out, $0.00006)")))).toEqual(["ranked 9 names"]);
  });

  // A table across the shelf ranks the paths once a cell, a level down, and each cell opens its own files there.
  test("follow a table across the shelf file by file, each under its cell", () => {
    const w = walkOf(
      parse(`question looks like a table question  in 0.6s (jev 0.6s, read 0.0s, other 0.0s; 5,784 tokens in, 1,470 out, $0.00024)
rows name documents (p=0.76): Heart, Vault Operations Manual; asks how many skills are there  in 0.3s (jev 0.3s, read 0.0s, other 0.0s; 3,163 tokens in, 721 out, $0.00013)
Heart: how many skills are there…
  question looks like a count question  in 0.2s (jev 0.2s, read 0.0s, other 0.0s; 2,377 tokens in, 546 out, $0.00010)
  ranked 9 paths and 0 excerpts in 0.2s (jev 0.2s, read 0.0s, other 0.0s; 1,319 tokens in, 148 out, $0.00006), 1 above file floor 1.5 (8 below)
  2.94  /shelf/heart.pdf…
    no outline: scanning 1 of 1 windows in page order…
      gated 1 pages (batch 1/1), 0.2s jev, 0 yes
      no   0.45  p.1 (window 1/1)
    no outline 0.2s (jev 0.2s, read 0.0s, other 0.0s; 468 tokens in, 23 out, $0.00002)
  file 2.5s (jev 0.2s, read 0.0s, embed 2.2s, other 0.0s; 468 tokens in, 23 out, $0.00002)  1 windows read
Heart: how many skills are there: N/A (1 file opened, none answered)  in 2.9s (jev 0.7s, read 0.0s, embed 2.2s, other 0.0s; 4,164 tokens in, 717 out, $0.00017)
Vault Operations Manual: how many skills are there…
  question looks like a count question  in 0.3s (jev 0.3s, read 0.0s, other 0.0s; 2,895 tokens in, 682 out, $0.00012)
  ranked 9 paths and 0 excerpts in 0.4s (jev 0.4s, read 0.0s, other 0.0s; 1,321 tokens in, 148 out, $0.00006), 3 above file floor 1.5 (6 below)
  2.61  /shelf/manual.pdf…
    ranked from cache in 0.1s (jev 0.0s, read 0.0s, embed 0.1s, other 0.0s): "how many classes are there in Vault Operations Manual?" (question 0.69, subject 0.84)
    section Chapter I: Skills  p.1-1…
      gated 1 pages (batch 1/1), 0.2s jev, 1 yes  Chapter I: Skills
      yes  0.81  Chapter I: Skills p.1
      take  7 (p=1.00)  Chapter I: Skills p.1
    section 0.5s (jev 0.5s, read 0.0s, other 0.0s; 2,898 tokens in, 287 out, $0.00012)  Chapter I: Skills
  file 0.6s (jev 0.5s, read 0.0s, embed 0.1s, other 0.0s; 2,898 tokens in, 287 out, $0.00012)  1 windows read
Vault Operations Manual: how many skills are there: 7 (p=1.00)  in 1.3s (jev 1.2s, read 0.0s, embed 0.1s, other 0.0s; 7,114 tokens in, 1,117 out, $0.00030)
total 5.1s (jev 2.8s, read 0.1s, embed 2.3s, other 0.0s; 20,225 tokens in, 4,025 out, $0.00085)`),
    );
    expect(w.files.map((f) => [f.path, f.under, f.reads.map((r) => [r.kind, r.name, r.verdict])])).toEqual([
      ["/shelf/heart.pdf", "Heart: how many skills are there", [["window", "p.1 (window 1/1)", undefined]]],
      ["/shelf/manual.pdf", "Vault Operations Manual: how many skills are there", [["section", "Chapter I: Skills p.1", "take"]]],
    ]);
    expect(flowOf(w)).toEqual(["ranked 9 paths for each of 2 cells", "opened 2 files", "read 1 section and 1 window", "took manual.pdf p.1"]);
  });

  test("say what became of each read: the verdict, else the gate's, and the one under way while the run goes on", () => {
    const w = walkOf(
      parse(`section A  p.1-1…
  no   0.10  A p.1
section B  p.2-2…
  yes  0.97  B p.2
section C  p.3-3…`),
    );
    const [a, b, c] = w.files[0]!.reads;
    expect([stateOf(a!, true), stateOf(b!, true), stateOf(c!, true)]).toEqual(["no", "reading…", "reading…"]);
    expect([stateOf(a!, false), stateOf(b!, false), stateOf(c!, false)]).toEqual(["no", "yes", "–"]);
    expect(stateOf({ kind: "section", name: "D", gate: "yes", verdict: "drop" }, true)).toBe("drop");
  });
});

describe("columnsOf", () => {
  test("reads where each column of a built table came from, and only from the step that fills its cells", () => {
    const lines = [
      "columns: searched for 1 column  in 0.3s",
      "  weight: searching…",
      "cells: filling 6…",
      '  damage: "Damage" p.12',
      "  weight: each entry's label",
      "  notes: not in a table; from the rows' own cells",
      "cells: 6 of 6 filled, 0 other tables matched by row, 0 gaps left to the rows' own cells  in 0.4s",
      "  damage: 3 of 3 items found",
    ].map((l) => parseLine(l));
    expect(columnsOf(lines)).toEqual({ damage: '"Damage" p.12', weight: "each entry's label", notes: "not in a table; from the rows' own cells" });
  });
});

describe("gaugesOf", () => {
  const lines = `ranked 25 paths and 23 excerpts in 0.5s (jev 0.4s; 8,044 tokens in, 796 out, $0.00034), 3 above file floor 1.5 (22 below)
2.70  /books/Guide.pdf…
  ranked 169 sections and 20 excerpts in 0.5s (jev 0.3s; 27,803 tokens in, 3,174 out, $0.00117), 60 above title floor 1 (109 below)
  section Start  p.1-2…
    yes  0.20  Start p.1
  section 0.4s (jev 0.4s; 900 tokens in, 20 out, $0.00004)  Start
  section Rules  p.3-9…`
    .split("\n")
    .map((l) => parseLine(l));

  test("measure the files a shelf walk may open, the sections a file may read, and the step under way", () => {
    expect(gaugesOf(lines, "Rules 4 pages (batch 2/3)", { max: 12, maxFiles: 5 })).toEqual([
      { label: "1 file opened, up to 5", done: 1, of: 5, cap: true },
      { label: "2 sections read in this file, up to 12", done: 2, of: 12, cap: true },
      { label: "batch 2 of 3 in this step", done: 1, of: 3 },
    ]);
  });

  test("say nothing before the log does", () => {
    expect(gaugesOf([], undefined, { max: 12 })).toEqual([]);
  });

  test("count a cell's own files in a table across the shelf, and windows in a book without an outline", () => {
    const across = `Heart: skills…
  ranked 9 paths and 0 excerpts in 0.2s (jev 0.2s; 1,319 tokens in, 148 out, $0.00006), 1 above file floor 1.5 (8 below)
  2.94  /shelf/heart.pdf…
    no outline: scanning 1 of 1 windows in page order…
      no   0.45  p.1 (window 1/1)
  file 2.5s (jev 0.2s; 468 tokens in, 23 out, $0.00002)  1 windows read
Heart: skills: N/A (1 file opened, none answered)  in 2.9s (jev 0.7s; 4,164 tokens in, 717 out, $0.00017)
Manual: skills…
  ranked 9 paths and 0 excerpts in 0.4s (jev 0.4s; 1,321 tokens in, 148 out, $0.00006), 3 above file floor 1.5 (6 below)`
      .split("\n")
      .map((l) => parseLine(l));
    expect(gaugesOf(across, undefined, { max: 12, maxFiles: 5 })).toEqual([
      { label: "0 files opened for this cell, up to 5", done: 0, of: 5, cap: true },
    ]);
    expect(gaugesOf(across.slice(0, 5), undefined, { max: 12, maxFiles: 5 })).toEqual([
      { label: "1 file opened, up to 5", done: 1, of: 5, cap: true },
      { label: "1 window read in this file, up to 12", done: 1, of: 12, cap: true },
    ]);
  });
});

describe("errorText", () => {
  // What the tool printed on a zero-byte PDF: its log, the code frame, the error, and the stack.
  const crash = `question looks like a number question  in 0.5s (jev 0.5s, read 0.0s, other 0.0s; 1,859 tokens in, 410 out, $0.00008)
searches for tax
56 |
57 | export function run(cmd: string[], kind: keyof typeof clock = "extract"): Promise<string> {
61 |     if ((await p.exited) !== 0) throw new Error(\`\${cmd[0]} failed: \${err.trim()}\`);
                                               ^
error: mutool failed: format error: cannot find version marker
warning: trying to repair broken xref
warning: repairing PDF document
Error: no objects found
	at Document.openDocument (native)
	at [string]:1
      at <anonymous> (/repo/pdf.ts:61:43)
      at async timed (/repo/shared.ts:72:18)

Bun v1.4.2 (Linux x64)`.split("\n");

  test("keeps an uncaught error from its own line on, and none of the frames", () => {
    expect(errorText(crash)).toBe("error: mutool failed: format error: cannot find version marker\nwarning: trying to repair broken xref\nwarning: repairing PDF document\nError: no objects found");
  });

  test("takes a tool's own last lines when nothing was thrown", () => {
    expect(errorText(["searches for tax", "jevsec: the ranking cache can't run", "start Ollama, or pass --cache off"])).toBe("searches for tax\njevsec: the ranking cache can't run\nstart Ollama, or pass --cache off");
    expect(errorText(["a", "b", "c", "d"], 2)).toBe("c\nd");
    expect(errorText(["    at x (y.ts:1:1)", "Bun v1.4.2 (Linux x64)"])).toBe("");
  });

  test("knows a crash's frames from the lines the tool said", () => {
    expect(crash.filter((l) => !isFrame(parseLine(l).text)).map((l) => l.trim())).toEqual([
      "question looks like a number question  in 0.5s (jev 0.5s, read 0.0s, other 0.0s; 1,859 tokens in, 410 out, $0.00008)",
      "searches for tax",
      "error: mutool failed: format error: cannot find version marker",
      "warning: trying to repair broken xref",
      "warning: repairing PDF document",
      "Error: no objects found",
      "",
    ]);
  });

  test("reads the same again, so a stored error can be shown through it", () => {
    const once = errorText(crash);
    expect(errorText(once.split("\n"), Infinity)).toBe(once);
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
