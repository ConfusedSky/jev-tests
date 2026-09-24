import { describe, expect, test } from "bun:test";
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { annotate, deriveCells, entriesOf, entryPieces, itemsOf, labelsFor, matchRows, namesBy, pickTable, piecesOf, readRequest, sameNames, tablesIn, type Found } from "./compose";
import { wordsOf } from "./answer";
import type { Para } from "./layout";
import type { Hit } from "./pdf";

type Question = { type: string; instructions: string; criteria?: Record<string, string> };
/** A client answering each question by `answer`, given its key and the question. */
const stub = (answer: (key: string, q: Question) => unknown) =>
  ({
    systemOne: async ({ questions }: { questions: Record<string, Question> }) => ({
      answers: Object.fromEntries(Object.entries(questions).map(([k, q]) => [k, answer(k, q)])),
    }),
  }) as unknown as TypeSafeClient;
const picked = (choice: string) => ({ type: "choice", choice, confidence: 1, probabilities: { [choice]: 1 } });

const heads = ["Weapon Type", "Standard Magazine", "Cost"];
const row = (cells: string[]): Para => ({
  heading: false,
  text: cells.join(" "),
  style: "",
  lines: cells.flatMap((c, i) => (c ? [{ page: 95, x0: i * 100, y0: 0, x1: i * 100 + 90, y1: 10, start: 0, end: 1, cell: i }] : [])),
  table: { heads, cells },
});
const hit = (passage: Para[]): Hit => ({ pdf: "book.pdf", section: "Ranged Weapons", page: 95, p: 0.9, text: "", answer: { text: "", p: 0.9, passage } });

describe("tablesIn", () => {
  test("groups a passage's rows by their heads and leaves out the notes under them and the prose", () => {
    const [t, ...rest] = tablesIn(
      hit([
        { heading: false, text: "Weapons.", style: "", lines: [] },
        row(["Medium Pistol", "12 (M Pistol)", "50eb"]),
        row(["Alt. Fire Modes: None", "", ""]),
        row(["Shotgun", "4 (Slug)", "500eb"]),
      ]),
    );
    expect(rest).toEqual([]);
    expect(t!.heads).toBe(heads);
    expect(t!.rows.map((r) => r.cells[0])).toEqual(["Medium Pistol", "Shotgun"]);
  });

  test("a heading between rows of the same heads starts another table; the ellipsis between two runs of one does not", () => {
    const tables = tablesIn(
      hit([
        row(["Medium Pistol", "12 (M Pistol)", "50eb"]),
        { heading: false, text: "…", style: " ", lines: [] },
        row(["Shotgun", "4 (Slug)", "500eb"]),
        { heading: true, text: "Exotic Weapons", style: "", lines: [] },
        row(["Air Pistol", "N/A", "100eb"]),
      ]),
    );
    expect(tables.map((t) => t.rows.map((r) => r.cells[0]))).toEqual([["Medium Pistol", "Shotgun"], ["Air Pistol"]]);
  });
});

describe("pickTable", () => {
  test("of several tables, takes the one jev says has a row for each of the things", async () => {
    const [ammo, guns] = [
      { heads: ["Ammo", "Cost"], rows: [{ cells: ["Slug", "10eb"], lines: [] }], hit: hit([]) },
      { heads: ["Gun", "Cost"], rows: [{ cells: ["Shotgun", "500eb"], lines: [] }], hit: hit([]) },
    ];
    let offered = "";
    const client = stub((_, q) => ((offered = JSON.stringify(q.criteria)), picked("t1")));
    expect(await pickTable(client, "q", "guns", [ammo, guns])).toBe(guns);
    expect(offered).toContain('with rows such as \\"Shotgun\\"');
  });
});

describe("sameNames", () => {
  test("matches row names ignoring case and punctuation, and leaves the rest unmatched", () => {
    expect(sameNames(["Medium Pistol", "SMG", "Bows & Crossbows"], ["smg", "Medium pistol"])).toEqual([1, 0, undefined]);
  });
});

describe("piecesOf", () => {
  test("the same text in two cells is offered for each, so a pick is marked on its own cell", () => {
    expect(piecesOf(["1", "1"])).toEqual([
      { text: "1", cell: 0 },
      { text: "1", cell: 1 },
    ]);
  });

  test("offers each cell whole, around and inside its brackets, and between its bullets", () => {
    expect(piecesOf(["12 (M Pistol)", "Autofire (3) • Suppressive Fire"])).toEqual([
      { text: "12 (M Pistol)", cell: 0 },
      { text: "12", cell: 0 },
      { text: "M Pistol", cell: 0 },
      { text: "Autofire (3) • Suppressive Fire", cell: 1 },
      { text: "Autofire", cell: 1 },
      { text: "3", cell: 1 },
      { text: "Suppressive Fire", cell: 1 },
      { text: "Autofire (3)", cell: 1 },
    ]);
  });
});

describe("readRequest", () => {
  const q = "Give me each of the standard ranged weapons as a row with rate of fire, standard magazine size and ammo type";
  /** Says yes to the listed words as rows or columns, the "standard" of the rows' name as both. */
  const client = stub((key) => {
    const i = Number(key.slice(1));
    const word = q.split(" ")[i]!.replace(/,$/, "");
    const rows = ["each", "standard", "ranged", "weapons"].includes(word) && i < 8;
    const cols = ["rate", "fire", "standard", "magazine", "size", "ammo", "type"].includes(word);
    return { type: "noul", noul: key[0] === "a" ? 0.1 : (key[0] === "r" ? rows : cols) ? 0.9 : 0.1 };
  });

  test("with no word naming the rows, there are none, and every column word stays a column", async () => {
    const none = stub((key) => ({ type: "noul", noul: key[0] === "c" && key !== "c0" ? 0.9 : 0.1 }));
    expect(await readRequest(none, "Columns damage, cost")).toEqual({ things: "", columns: ["damage", "cost"], annotated: [] });
  });

  test("the rows are the first name, without its each; its words are not columns; an of between column words stays", async () => {
    expect(await readRequest(client, q)).toEqual({
      things: "standard ranged weapons",
      columns: ["rate of fire", "standard magazine size", "ammo type"],
      annotated: [],
    });
  });
});

describe("matchRows", () => {
  const theirs: Found = {
    heads: ["Type", "Drum"],
    rows: [["Medium Pistol", "36"], ["Bow", "1"], ["Shotgun", "16"]].map((cells) => ({ cells, lines: [] })),
    hit: hit([]),
  };

  test("a row of the same name matches without asking; the rest are asked among the rows left", async () => {
    const asked: string[][] = [];
    const client = stub((_, q) => {
      asked.push(Object.values(q.criteria ?? {}));
      return picked(q.instructions.includes("Bows") ? "o1" : "none");
    });
    expect(await matchRows(client, "q", ["Medium Pistol", "Bows & Crossbows", "Rocket Launcher"], theirs)).toEqual([0, 1, undefined]);
    // Medium Pistol matched by name, so only Bow and Shotgun are offered.
    expect(asked).toEqual([
      ['The row "Bow"', 'The row "Shotgun"', "None of them is"],
      ['The row "Bow"', 'The row "Shotgun"', "None of them is"],
    ]);
  });
});

describe("deriveCells", () => {
  const box = (cell: number) => ({ page: 95, x0: cell * 100, y0: 0, x1: cell * 100 + 90, y1: 10, start: 0, end: 1, cell });
  const ours: Found = {
    heads,
    rows: [
      { cells: ["Medium Pistol", "12 (M Pistol)", "50eb"], lines: [box(0), box(1), box(2)] },
      { cells: ["Rocket Launcher", "1 (Rocket)", "500eb"], lines: [box(0), box(1), box(2)] },
    ],
    hit: hit([]),
  };

  test("reads a value from a piece of the row's own cells, marked on that cell, keyed by row and column; none leaves it out", async () => {
    // Picks the bracketed piece for the pistol, and none for the launcher.
    const client = stub((key) => picked(key === "a0" ? "p2" : "none"));
    const d = await deriveCells(client, "q", ours, [
      { row: 0, j: 4, column: "ammo type" },
      { row: 1, j: 4, column: "ammo type" },
    ]);
    expect([...d.entries()]).toEqual([["0 4", { text: "M Pistol", from: "12 (M Pistol)", lines: [box(1)] }]]);
  });
});

describe("entries", () => {
  const para = (text: string, heading = false): Para => ({ heading, text, style: "", lines: [{ page: 98, x0: 0, y0: 0, x1: 1, y1: 1, start: 0, end: 1 }] });
  const paras = [
    para("Small Guns Complications", true),
    para("Wasteful: you fired more than you thought."),
    para(".44 PISTOL", true),
    para("Ammunition: .44 Magnum"),
    para("The .44 pistol is a double-action revolver."),
    para("• Receiver: Hardened, Powerful"),
    para("10MM PISTOL", true),
    para("Ammunition: 10mm"),
  ];

  test("a row's entry runs from the heading that is its name, whatever its case, to the next heading", () => {
    const entries = entriesOf(paras, [".44 Pistol", "10mm Pistol", "Syringer"]);
    expect([...entries.keys()]).toEqual([0, 1]);
    expect(entries.get(0)!.map((p) => p.text)).toEqual(["Ammunition: .44 Magnum", "The .44 pistol is a double-action revolver.", "• Receiver: Hardened, Powerful"]);
  });

  test("an entry offers its labelled lines' values, each with the line it came from", () => {
    expect(entryPieces(entriesOf(paras, [".44 Pistol"]).get(0)!).map(({ label, text, from }) => ({ label, text, from }))).toEqual([
      { label: "Ammunition", text: ".44 Magnum", from: "Ammunition: .44 Magnum" },
      { label: "Receiver", text: "Hardened, Powerful", from: "• Receiver: Hardened, Powerful" },
    ]);
  });
});

describe("labelsFor", () => {
  test("each column picks one label the entries share, or none, in one call", async () => {
    let calls = 0;
    const client = stub((key) => (calls++, picked(key === "c0" ? "l0" : "none")));
    expect(await labelsFor(client, "q", ["ammo type", "weight"], ["Ammunition", "Receiver"])).toEqual(["Ammunition", undefined]);
    expect(calls).toBe(2);
  });

  test("with no labels nothing is asked", async () => {
    const client = stub(() => {
      throw new Error("asked");
    });
    expect(await labelsFor(client, "q", ["ammo type"], [])).toEqual([undefined]);
  });
});

describe("namesBy", () => {
  const words = wordsOf("Show the small guns with Barrel Mods, rate of fire. Each Mod column");
  const at = (...ws: string[]) => (i: number) => ws.includes(words[i]!.word);

  test("a name starts at a sure word and runs on through half-sure ones; a comma or full stop ends it; an of joins", () => {
    expect(namesBy(words, at("small", "Barrel", "rate"), at("guns", "Mods", "fire"), true).map((n) => n.name)).toEqual(["small guns", "Barrel Mods", "rate of fire"]);
  });

  test("a half-sure word starts nothing; without `of` an of ends the name", () => {
    expect(namesBy(words, at("rate"), at("guns", "fire")).map((n) => n.name)).toEqual(["rate"]);
  });
});

describe("itemsOf", () => {
  test("a cell's items are its parts between commas, semicolons and bullets", () => {
    expect(itemsOf("Reflex Sight, Short Scope; Recon Scope • Long Scope")).toEqual(["Reflex Sight", "Short Scope", "Recon Scope", "Long Scope"]);
    expect(itemsOf("")).toEqual([]);
  });
});

describe("annotate", () => {
  const mods = (page: number, rows: [string, string][]): Found => ({
    heads: ["MOD", "EFFECTS", "COST"],
    rows: rows.map(([name, cost]) => ({ cells: [name, "fx", cost], lines: [{ page, x0: 0, y0: 0, x1: 1, y1: 1, start: 0, end: 1, cell: 2 }] })),
    hit: { ...hit([]), page },
  });
  const near = mods(102, [["Long", "+20"], ["Bull Barrel", "+10"]]);
  const far = mods(106, [["Bull Barrel", "+99"]]);
  /** Every table's cost is its third column; "Long Barrel" is the row "Long". */
  const client = stub((key, q) => {
    if (key.startsWith("t")) return picked("c2");
    return picked(q.instructions.includes("Long Barrel") ? "o0" : "none");
  });

  test("an item takes its value from the nearest table naming it, with that cell's box; one named by no table is matched by jev in the table most came from", async () => {
    const v = await annotate(client, "q", "cost", ["Bull Barrel", "Long Barrel", "Short"], [near, far]);
    expect(v.get("Bull Barrel")?.text).toBe("+10");
    expect(v.get("Bull Barrel")?.lines[0]?.page).toBe(102);
    expect(v.get("Long Barrel")).toMatchObject({ text: "+20", from: "Long" });
    expect(v.has("Short")).toBe(false);
  });
});

describe("readRequest's instruction", () => {
  const q = "Show me the small guns with columns Damage and Sight Mods. For each Mod column add the cost in parenthesis.";
  const ws = wordsOf(q).map((w) => w.word);
  const score: Record<string, [number, number, number]> = {
    // word: [rows, column, add]
    small: [0.9, 0.1, 0.1],
    guns: [0.4, 0.1, 0.1],
    Damage: [0.1, 0.9, 0.1],
    Sight: [0.1, 0.9, 0.1],
    Mods: [0.1, 0.4, 0.6],
    Mod: [0.1, 0.6, 0.7],
    cost: [0.1, 0.4, 0.9],
  };
  const client = stub((key, question) => {
    if (key.startsWith("k")) return { type: "noul", noul: question.instructions.includes('"Sight Mods"') ? 0.9 : 0.1 };
    const [r, c, a] = score[ws[Number(key.slice(1))]!] ?? [0.1, 0.1, 0.1];
    return { type: "noul", noul: key[0] === "r" ? r : key[0] === "c" ? c : a };
  });

  test("what to add is read apart from the columns, which keep their half-sure words, and it goes on the columns it names", async () => {
    expect(await readRequest(client, q)).toEqual({ things: "small guns", columns: ["Damage", "Sight Mods"], add: "cost", annotated: [1] });
  });
});
