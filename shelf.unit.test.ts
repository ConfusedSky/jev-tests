import { describe, expect, test } from "bun:test";
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { wordsOf } from "./answer";
import { renderRows } from "./cli";
import { NA } from "./compose";
import type { Hit } from "./pdf";
import { acrossRows, cellOf, cellQuestion, findDefaults, readAcross, scoreRows, spansOf, where, type Walked } from "./shelf";

type Question = { type: string; instructions: string };
/** A client answering each noul by `p`, given its key and the word it asks of. */
const stub = (p: (key: string, word: string) => number) =>
  ({
    systemOne: async ({ questions }: { questions: Record<string, Question> }) => ({
      answers: Object.fromEntries(Object.entries(questions).map(([k, q]) => [k, { type: "noul", noul: p(k, /\("(.*?)"\)/.exec(q.instructions)?.[1] ?? "") }])),
    }),
  }) as unknown as TypeSafeClient;

const question = "Give me a table with Heart, Legend in the Mist and Cyberpunk Red as rows and ask how many skills are there for each row";

describe("readAcross", () => {
  test("a row runs through its title's doubted words and splits at a joining word jev all but rules out; a column keeps its whole question", async () => {
    // Per-word probabilities as jev gave them for this request.
    const r: Record<string, number> = { Heart: 0.8, Legend: 0.43, in: 0.81, the: 0.46, Mist: 0.57, and: 0.06, Cyberpunk: 0.95, Red: 0.87 };
    const q: Record<string, number> = { how: 0.88, many: 0.91, skills: 0.9, are: 0.77, there: 0.93, for: 0.32, each: 0.33, and: 0.39 };
    const client = stub((key, word) => (key === "across" ? 0.9 : key[0] === "r" ? (r[word] ?? 0.03) : (q[word] ?? 0.1)));
    const read = await readAcross(client, question);
    expect(read.p).toBe(0.9);
    expect(read.rows).toEqual(["Heart", "Legend in the Mist", "Cyberpunk Red"]);
    expect(read.columns).toEqual(["how many skills are there"]);
    expect(read.row).toHaveLength(read.words.length);
  });

  test("a name neither starts nor ends on a joining word, and is never joining words alone", () => {
    expect(spansOf(wordsOf("the Heart of"), [0.9, 0.9, 0.9], [0, 0, 0]).rows).toEqual(["Heart"]);
    expect(spansOf(wordsOf("in the"), [0.9, 0.9], [0, 0]).rows).toEqual([]);
  });

  test("two questions joined by a word jev doubts are two columns", () => {
    const words = wordsOf("how many skills and how many classes");
    const q = words.map((w) => (w.word === "and" ? 0.39 : 0.8));
    expect(spansOf(words, words.map(() => 0), q).columns).toEqual(["how many skills", "how many classes"]);
  });
});

test("a cell's question asks its column of its row as a question about one book is put", () => {
  expect(cellQuestion("Heart", "how many skills are there")).toBe("how many skills are there in Heart?");
});

describe("cells", () => {
  const hit = (section: string, answer = { text: "9", p: 0.97 }): Hit => ({ pdf: "heart.pdf", section, page: 12, p: 0.9, text: "", answer });
  const walked = (w: Partial<Walked>): Walked => ({ hits: [], tried: [], rejected: [], dropped: [], opened: 1, above: 1, considered: 1, ...w });
  const o = findDefaults();

  test("a value is its answer; a passage is where it stands, a page-named window by its page alone", () => {
    expect(cellOf("count", walked({ hit: hit("Skills") }), o).text).toBe("9");
    expect(cellOf("passage", walked({ hit: hit("Rules > Skills") }), o).text).toBe("p.12 Skills");
    expect(where(hit("p.12"))).toBe("p.12");
    expect(where(hit("p.12-14"))).toBe("p.12-14");
  });

  test("with no hit a cell is N/A, saying why", () => {
    const below = cellOf("count", walked({ rejected: [{ hit: hit("Skills"), answer: { text: "8", p: 0.5 } }] }), o);
    expect(below).toMatchObject({ text: NA, why: "best 8, below 0.7" });
    expect(below.hit?.answer?.text).toBe("8");
    expect(cellOf("count", walked({ opened: 0, above: 0 }), o)).toMatchObject({ text: NA, why: "no file's name reached the file floor 1.5" });
    expect(cellOf("count", walked({ opened: 0, above: 1 }), o)).toMatchObject({ text: NA, why: "no file above the file floor was a readable PDF" });
    expect(cellOf("count", walked({ opened: 2 }), o)).toMatchObject({ text: NA, why: "2 files opened, none answered" });
  });

  test("a row whose cells are N/A prints as a row of the grid, not a note", () => {
    const t = { rows: ["Heart", "Fallout"], columns: ["how many skills are there"], cells: [[{ text: "9", kind: "count" as const }], [{ text: NA, kind: "count" as const }]] };
    expect(renderRows(acrossRows(t), 80).map((l) => l.replace(/\u001b\[[0-9;]*m/g, "").trimEnd())).toEqual([
      "name     how many skills are there",
      "Heart    9",
      "Fallout  N/A",
    ]);
  });

  test("the bench scores each true row by name, a row not read scoring 0", () => {
    const t = { rows: ["heart", "Fallout"], columns: ["q"], cells: [[{ text: "9", kind: "count" as const }], [{ text: "16", kind: "count" as const }]] };
    const exact = (got: string, want: number) => (Number(got) === want ? 1 : 0);
    expect(scoreRows(t, { Heart: 9, Fallout: 17, "Cyberpunk Red": 66 }, exact)).toBeCloseTo(1 / 3);
  });
});
