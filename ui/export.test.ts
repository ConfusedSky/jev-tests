import { describe, expect, test } from "bun:test";
import { acrossGrid, answerText, citation, csv, fileStem, markdown, runJson, tableGrid } from "./export";
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
  test("puts a figure on its line and a passage in full, the citation last", () => {
    expect(answerText(hit)).toBe("7\n— My Book.pdf, p.12 (Rules > Combat)");
    const passage = [
      { heading: true, text: "COMBAT", style: "" },
      { heading: false, text: "Roll a die.", style: "" },
      { heading: false, text: "", style: "", table: { heads: ["Weapon", "Damage"], cells: ["Sword", "1d8"] } },
    ];
    expect(answerText({ ...hit, answer: { text: "", p: 0.9, passage } })).toBe("COMBAT\nRoll a die.\nSword\t1d8\n— My Book.pdf, p.12 (Rules > Combat)");
    expect(answerText({ ...hit, answer: undefined })).toBe("— My Book.pdf, p.12 (Rules > Combat)");
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

  test("a table across the shelf leads with the document", () => {
    expect(acrossGrid({ rows: ["A", "B"], columns: ["skills"], cells: [[{ text: "7", kind: "count" }], [{ text: "N/A", kind: "count", why: "none" }]] })).toEqual([["document", "skills"], ["A", "7"], ["B", "N/A"]]);
  });
});

describe("runJson", () => {
  test("holds the request, the outcome and the log as printed", () => {
    const run: Run = {
      id: "r1",
      request: { tool: "jevsec", question: "q", options: {} as Run["request"]["options"], pdf: "/a.pdf" },
      command: "bun jevsec.ts /a.pdf q",
      at: 0,
      lines: [parseLine("section A…"), parseLine("  yes  0.90  A p.1")],
      status: "done",
      end: { type: "end", code: 1, ms: 5, error: "boom" },
    };
    const j = JSON.parse(runJson(run)) as { outcome: string; log: string[]; error: string; at: string };
    expect(j.outcome).toBe("error");
    expect(j.log).toEqual(["section A…", "  yes  0.90  A p.1"]);
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
