import { describe, expect, test } from "bun:test";
import { acrossGrid, answerText, citation, csv, fileStem, markdown, passageText, runJson, sourceLine, tableGrid } from "./export";
import { parseLine } from "./log";
import type { Run } from "./run";
import type { JsonHit } from "./types";

const hit: JsonHit = { pdf: "/books/My Book.pdf", view: "/cache/x.pdf", page: 12, section: "Rules > Combat", found: 0.9, answer: { text: "7", p: 0.95 } };

describe("citation", () => {
  test("names the book, the page and the section, unless the section is only the page", () => {
    expect(citation(hit)).toBe("My Book.pdf, p.12 (Rules > Combat)");
    expect(citation({ ...hit, section: "p.12" })).toBe("My Book.pdf, p.12");
  });
});

describe("answerText", () => {
  const asked = { question: "How many?", floor: 0.7 };

  test("puts the question first, a figure on its line or a passage in full, then where it stands and how sure it is", () => {
    expect(answerText(hit, asked)).toBe("Q: How many?\n7\n— My Book.pdf, p.12 (Rules > Combat) · p=0.95");
    const passage = [
      { heading: true, text: "COMBAT", style: "" },
      { heading: false, text: "Roll a die.", style: "" },
      { heading: false, text: "", style: "", table: { heads: ["Weapon", "Damage"], cells: ["Sword", "1d8"] } },
    ];
    expect(answerText({ ...hit, answer: { text: "", p: 0.9, passage } }, asked)).toBe("Q: How many?\nCOMBAT\nRoll a die.\nWeapon\tDamage\nSword\t1d8\n— My Book.pdf, p.12 (Rules > Combat) · p=0.90");
    expect(answerText({ ...hit, answer: undefined }, asked)).toBe("Q: How many?\n— My Book.pdf, p.12 (Rules > Combat)");
  });

  test("says when the answer is below the floor", () => {
    expect(answerText({ ...hit, answer: { text: "7", p: 0.55 } }, { ...asked, below: true })).toEndWith("· p=0.55, below the answer floor 0.7");
  });
});

describe("passageText", () => {
  const row = (heads: string[], cells: string[]) => ({ heading: false, text: "", style: "", table: { heads, cells } });

  test("gives each run of a table's rows its heads once, and a new table its own", () => {
    const paras = [row(["A", "B"], ["1", "2"]), row(["A", "B"], ["3", "4"]), { heading: false, text: "Then:", style: "" }, row(["A", "B"], ["5", "6"]), row(["C"], ["7"])];
    expect(passageText(paras)).toBe("A\tB\n1\t2\n3\t4\nThen:\nA\tB\n5\t6\nC\n7");
  });

  test("gives no head line to rows without heads", () => {
    expect(passageText([row(["", ""], ["1", "2"])])).toBe("1\t2");
  });
});

describe("tables", () => {
  const grid = tableGrid([
    { heads: ["Weapon", "Damage"], cells: ["Sword, long", "1d8"] },
    { heads: ["Weapon", "Damage"], cells: ['Axe "big"', "1d12|2"] },
  ]);

  test("start with the heads", () => {
    expect(grid[0]).toEqual(["Weapon", "Damage"]);
  });

  test("as CSV quote commas, quotes and line breaks", () => {
    expect(csv(grid)).toBe('Weapon,Damage\r\n"Sword, long",1d8\r\n"Axe ""big""",1d12|2\r\n');
  });

  test("as Markdown escape pipes and pad short rows", () => {
    expect(markdown([...grid, ["Bow"]])).toBe("| Weapon | Damage |\n| --- | --- |\n| Sword, long | 1d8 |\n| Axe \"big\" | 1d12\\|2 |\n| Bow |  |\n");
    expect(markdown([])).toBe("");
  });

  test("end on their source, the head row still first", () => {
    const source = sourceLine("What do weapons do?", "My Book.pdf, p.12");
    expect(source).toBe("Source: My Book.pdf, p.12. Asked of jev: “What do weapons do?”");
    expect(csv([["a"], ["1"]], source)).toBe(`a\r\n1\r\n\r\n"${source}"\r\n`);
    expect(csv([["a"]], 'Source: "x", y')).toBe('a\r\n\r\n"Source: ""x"", y"\r\n');
    expect(markdown([["a"], ["1"]], source)).toBe(`| a |\n| --- |\n| 1 |\n\n${source}\n`);
  });

  test("a table across the shelf leads with the document", () => {
    expect(acrossGrid({ rows: ["A", "B"], columns: ["skills"], cells: [[{ text: "7", kind: "count" }], [{ text: "N/A", kind: "count", why: "best 7, below 0.7" }]] })).toEqual([["document", "skills"], ["A", "7"], ["B", "N/A (best 7, below 0.7)"]]);
  });
});

describe("runJson", () => {
  test("holds the request, the outcome and the log as printed, each line's time kept", () => {
    const run: Run = {
      id: "r1",
      request: { tool: "jevsec", question: "q", options: {} as Run["request"]["options"], pdf: "/a.pdf" },
      command: "bun jevsec.ts /a.pdf q",
      at: 0,
      lines: [parseLine("section A…", 0), parseLine("  yes  0.90  A p.1", 1250)],
      status: "done",
      end: { type: "end", code: 1, ms: 5, error: "boom" },
    };
    const j = JSON.parse(runJson(run)) as { outcome: string; log: { ms: number; line: string }[]; error: string; at: string };
    expect(j.outcome).toBe("error");
    expect(j.log).toEqual([
      { ms: 0, line: "section A…" },
      { ms: 1250, line: "  yes  0.90  A p.1" },
    ]);
    expect(j.error).toBe("boom");
    expect(j.at).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("fileStem", () => {
  test("is the question's words, cut at a word", () => {
    expect(fileStem("How many skills are there?")).toBe("how-many-skills-are-there");
    expect(fileStem("How many skills are there in the book?", 20)).toBe("how-many-skills-are");
    expect(fileStem("???")).toBe("run");
  });
});
