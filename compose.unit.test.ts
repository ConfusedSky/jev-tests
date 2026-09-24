import { describe, expect, test } from "bun:test";
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { deriveCells, entriesOf, entryPieces, labelsFor, matchRows, piecesOf, readRequest, sameNames, tablesIn, type Found } from "./compose";
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
});

describe("sameNames", () => {
  test("matches row names ignoring case and punctuation, and leaves the rest unmatched", () => {
    expect(sameNames(["Medium Pistol", "SMG", "Bows & Crossbows"], ["smg", "Medium pistol"])).toEqual([1, 0, undefined]);
  });
});

describe("piecesOf", () => {
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
    return { type: "noul", noul: (key[0] === "r" ? rows : cols) ? 0.9 : 0.1 };
  });

  test("the rows are the first name, without its each; its words are not columns; an of between column words stays", async () => {
    expect(await readRequest(client, q)).toEqual({
      things: "standard ranged weapons",
      columns: ["rate of fire", "standard magazine size", "ammo type"],
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
    const d = await deriveCells(client, "q", ours, [{ column: "ammo type", j: 4 }]);
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
