import { describe, expect, test } from "bun:test";
import { jsonHit, marksOf, num, parseFlags, readDefaults, readFlags, renderPassage, sizedHit, tsvRows } from "./cli";
import type { Para } from "./layout";

const usage = (code: number): never => {
  throw new Error(`usage ${code}`);
};

describe("parseFlags", () => {
  test("sets flags by either name and returns the positionals", () => {
    const o = { top: 0, json: false };
    const rest = parseFlags(["-n", "3", "what", "--json", "is", "it"], o, {
      "-n|--top": num("top"),
      "--json": (o) => (o.json = true),
    }, usage);
    expect(o).toEqual({ top: 3, json: true });
    expect(rest).toEqual(["what", "is", "it"]);
  });

  test("a flag missing its value reads as empty", () => {
    const o = { model: "x" };
    parseFlags(["--model"], o, { "--model": (o, next) => (o.model = next()) }, usage);
    expect(o.model).toBe("");
  });

  test("-h asks for usage", () => {
    expect(() => parseFlags(["-h"], {}, {}, usage)).toThrow("usage 0");
  });

  // Folding an unknown flag into the positionals asked a different question.
  test("an unknown flag is an error, not a positional", () => {
    expect(() => parseFlags(["ask", "--typo"], {}, {}, usage)).toThrow("usage 1");
  });

  test("a lone dash is a positional, since stdin is spelled that way", () => {
    expect(parseFlags(["-"], {}, {}, usage)).toEqual(["-"]);
  });

  test("a number flag rejects a value that is not one", () => {
    expect(() => parseFlags(["-n", "abc"], { top: 0 }, { "-n": num("top") }, usage)).toThrow("usage 1");
    const o = { top: 0 };
    parseFlags(["-n", "-3.5"], o, { "-n": num("top") }, usage);
    expect(o.top).toBe(-3.5);
  });
});

describe("readFlags", () => {
  test("pages are gated one by one unless --whole-windows", () => {
    expect(readDefaults().perPage).toBe(true);
    const o = readDefaults();
    parseFlags(["--whole-windows"], o, readFlags(), usage);
    expect(o.perPage).toBe(false);
  });

  test("-n and --hits set how many passages to collect", () => {
    const o = readDefaults();
    parseFlags(["-n", "3"], o, readFlags(), usage);
    expect(o.hits).toBe(3);
    expect(readDefaults().hits).toBe(1);
  });

  test("--kind takes only the three kinds", () => {
    const o = readDefaults();
    parseFlags(["--kind", "count"], o, readFlags(), usage);
    expect(o.kind).toBe("count");
    expect(() => parseFlags(["--kind", "maybe"], readDefaults(), readFlags(), usage)).toThrow("usage 1");
  });
});


describe("renderPassage", () => {
  const heads = ["Small Gun", "Damage", "Notes", "Cost"];
  /** A row as layout.ts sets it: its filled cells as JSON keyed by the heads, or a lone cell bare. */
  const row = (cells: string[]): Para => {
    const filled = cells.map((c, i) => [heads[i]!, c] as const).filter(([, c]) => c);
    const text = filled.length === 1 ? filled[0]![1] : JSON.stringify(Object.fromEntries(filled));
    return { heading: false, text, style: " ".repeat(text.length), lines: [], table: { heads, cells } };
  };
  const prose = (text: string): Para => ({ heading: false, text, style: " ".repeat(text.length), lines: [] });
  const paras = [prose("Guns for sale."), row([".44 Pistol", "6", "", "99"]), row(["Combat Rifle", "5", "", "117"]), row(["Alt. Fire: None", "", "", ""])];
  const plain = (s: string) => s.replace(/\u001b\[[\d;]*m/g, "");

  test("a table's rows print as a grid under their bold heads, an empty column left out, a lone cell spanning", () => {
    const out = renderPassage(paras, 80, true);
    expect(out).toContain("  \u001b[1mSmall Gun     Damage  Cost\u001b[0m\n");
    expect(plain(out)).toBe(
      [
        "  Guns for sale.",
        "",
        "  Small Gun     Damage  Cost",
        "  .44 Pistol    6       99",
        "  Combat Rifle  5       117",
        "  Alt. Fire: None",
      ].join("\n"),
    );
  });

  test("rows that are all one cell print without a head line", () => {
    expect(renderPassage([row(["Alt. Fire: None", "", "", ""])], 80, true)).toBe("  Alt. Fire: None");
  });

  test("too wide for the window, a row prints a bold head and its cell a line, a long cell wrapping under itself", () => {
    const wide = [row([".44 Pistol", "6", "Loud, heavy and hard to find in the wastes", "99"]), row(["Combat Rifle", "5", "", "117"])];
    const out = renderPassage(wide, 40, true);
    expect(out).toContain("  \u001b[1mSmall Gun\u001b[0m  .44 Pistol");
    expect(plain(out)).toBe(
      [
        "  Small Gun  .44 Pistol",
        "  Damage     6",
        "  Notes      Loud, heavy and hard to",
        "             find in the wastes",
        "  Cost       99",
        "",
        "  Small Gun  Combat Rifle",
        "  Damage     5",
        "  Cost       117",
      ].join("\n"),
    );
  });

  test("a table takes the whole window while prose wraps at 100", () => {
    const words = "word ".repeat(30).trim();
    const out = plain(renderPassage([prose(words), row([".44 Pistol", "6", "x".repeat(100), "99"])], 140, true)).split("\n\n");
    expect(out[0]!.split("\n").every((l) => l.length <= 100)).toBe(true);
    expect(out[0]!.split("\n")).toHaveLength(2);
    expect(out[1]!.split("\n")).toHaveLength(2);
  });

  test("piped, a row stays its one line of text", () => {
    expect(renderPassage(paras.slice(1, 2), 80, false)).toBe(`  ${paras[1]!.text}`);
  });
});

describe("tsvRows", () => {
  test("heads then a row a line, tab-separated; a note is its one cell; a tab in a cell becomes a space", () => {
    const heads = ["Weapon", "Damage"];
    expect(tsvRows([{ heads, cells: ["SMG", "2d6"] }, { heads, cells: ["Alt. Fire:\tNone", ""] }])).toEqual(["Weapon\tDamage", "SMG\t2d6", "Alt. Fire: None"]);
  });

  test("piped with --tsv, a passage's rows print under their heads instead of as JSON", () => {
    const heads = ["Weapon", "Damage"];
    const row = (cells: string[]): Para => ({ heading: false, text: JSON.stringify(cells), style: "", lines: [], table: { heads, cells } });
    expect(renderPassage([row(["SMG", "2d6"]), row(["Shotgun", "5d6"])], 80, false, true)).toBe("Weapon\tDamage\nSMG\t2d6\nShotgun\t5d6");
  });
});

describe("jsonHit", () => {
  const box = { page: 3, x0: 0, y0: 0, x1: 1, y1: 1, start: 0, end: 4 };
  const hit = { pdf: "/b/book.pdf", section: "A > B", page: 3, p: 0.9, text: "", answer: { text: "Skills", p: 0.8, passage: [{ heading: true, text: "Skills", style: "bbbbbb", lines: [box] }] } };
  const size = { width: 612, height: 792 };

  test("keeps the passage's text and weights, and its boxes as marks with their page's size", () => {
    expect(jsonHit(hit, "/cache/x-book.pdf", { 3: size, 4: size })).toEqual({
      pdf: "/b/book.pdf",
      view: "/cache/x-book.pdf",
      page: 3,
      section: "A > B",
      found: 0.9,
      answer: { text: "Skills", p: 0.8, pages: undefined, passage: [{ heading: true, text: "Skills", style: "bbbbbb" }] },
      marks: [{ page: 3, x0: 0, y0: 0, x1: 1, y1: 1 }],
      pages: { 3: size },
    });
  });

  test("views the book itself when there is no highlighted copy", () => {
    expect(jsonHit({ ...hit, answer: undefined }).view).toBe("/b/book.pdf");
  });

  test("marks a passage's lines and cells across its pages, each box once", () => {
    const cell = (x0: number, page = 3) => ({ ...box, page, x0, x1: x0 + 10, cell: 1 });
    const passage = [
      { heading: false, text: "a", style: " ", lines: [box, cell(40)] },
      { heading: false, text: "b", style: " ", lines: [cell(40), cell(40, 4)] },
    ];
    const j = jsonHit({ ...hit, answer: { text: "a b", p: 0.9, passage } }, undefined, { 3: size, 4: size });
    expect(j.marks.map((m) => [m.page, m.x0])).toEqual([
      [3, 0],
      [3, 40],
      [4, 40],
    ]);
    expect(Object.keys(j.pages)).toEqual(["3", "4"]);
    // Only the box itself: the characters it holds are the passage's business.
    expect(Object.keys(j.marks[0]!)).toEqual(["page", "x0", "y0", "x1", "y1"]);
  });

  test("marks where a count's names or a figure stand, and nothing for a statement", () => {
    expect(marksOf({ text: "2", p: 1, marks: [box, { ...box, x0: 5, x1: 9 }] })).toHaveLength(2);
    const truth = jsonHit({ ...hit, answer: { text: "true", p: 0.9 } }, undefined, { 3: size });
    expect([truth.marks, truth.pages]).toEqual([[], {}]);
  });

  test("leaves out a size it was not given rather than guessing one", () => {
    expect(jsonHit(hit).pages).toEqual({});
  });
});

describe("sizedHit", () => {
  const manual = Bun.fileURLToPath(new URL("fixture/manual.pdf", import.meta.url));

  test("reads each marked page's size off the PDF", async () => {
    const answer = { text: "7", p: 1, marks: [{ page: 2, x0: 72, y0: 100, x1: 90, y1: 112, start: 0, end: 1 }] };
    const j = await sizedHit({ pdf: manual, section: "s", page: 2, p: 0.9, text: "", answer });
    expect(j.pages).toEqual({ 2: { width: 595, height: 842 } });
  });

  test("still answers when the PDF's sizes cannot be read", async () => {
    const answer = { text: "7", p: 1, marks: [{ page: 2, x0: 1, y0: 1, x1: 2, y1: 2, start: 0, end: 1 }] };
    const j = await sizedHit({ pdf: "/nowhere/gone.pdf", section: "s", page: 2, p: 0.9, text: "", answer });
    expect([j.marks.length, j.pages]).toEqual([1, {}]);
  });
});
