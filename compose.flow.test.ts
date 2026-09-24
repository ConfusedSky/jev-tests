import { expect, test } from "bun:test";
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { readDefaults } from "./cli";
import { composeTable, type Io } from "./compose";
import type { Para } from "./layout";
import type { Hit, Outcome } from "./pdf";

/** A table's rows as a passage: a box a cell on `page`. */
const table = (page: number, heads: string[], rows: string[][]): Para[] =>
  rows.map((cells) => ({
    heading: false,
    text: cells.join(" "),
    style: "",
    lines: cells.map((_, cell) => ({ page, x0: cell * 100, y0: 0, x1: cell * 100 + 90, y1: 10, start: 0, end: 1, cell })),
    table: { heads, cells },
  }));
const found = (page: number, passage: Para[]): Outcome => {
  const hit: Hit = { pdf: "book.pdf", section: "Weapons", page, p: 0.9, text: "", answer: { text: "", p: 0.9, passage } };
  return { hit, hits: [hit], tried: [], rejected: [], dropped: [] };
};

const weapons = table(95, ["Weapon Type", "Standard Magazine", "Cost"], [
  ["Medium Pistol", "12 (M Pistol)", "50eb"],
  ["Heavy Pistol", "8 (H Pistol)", "100eb"],
  ["Rocket Launcher", "1 (Rocket)", "500eb"],
]);
const clipChart = table(345, ["Type", "Standard", "Drum"], [
  ["Medium Pistol", "12", "36"],
  ["Heavy Pistol", "8", "28"],
  ["Rocket Launcher", "1", "3"],
]);

type Q = { type: string; instructions: string; criteria?: Record<string, string> };
const picked = (choice: string) => ({ type: "choice", choice, confidence: 1, probabilities: { [choice]: 1 } });
const noul = (yes: boolean) => ({ type: "noul", noul: yes ? 0.9 : 0.1 });

test("a column the rows' own cells state is read from them and never searched; the rest is searched, and no row is asked twice", async () => {
  const rowAsks: string[] = [];
  const client = {
    systemOne: async ({ questions }: { questions: Record<string, Q> }) => ({
      answers: Object.fromEntries(
        Object.entries(questions).map(([k, q]) => {
          const word = /\("(.*?)"\)/.exec(q.instructions)?.[1] ?? "";
          if (q.type === "noul" && /^r\d+$/.test(k)) return [k, noul(word === "weapons")];
          if (q.type === "noul" && /^c\d+$/.test(k)) return [k, noul(["ammo", "type", "drum", "magazine", "size"].includes(word))];
          if (q.type === "noul") return [k, noul(false)];
          const options = Object.entries(q.criteria ?? {});
          if (q.instructions.startsWith("Which part of the row")) {
            rowAsks.push(q.instructions);
            // The row's bracketed piece is its ammo type; nothing in it is a drum size.
            const ammo = options.find(([, d]) => /^"(M Pistol|H Pistol|Rocket)"/.test(d));
            return [k, picked(q.instructions.endsWith("ammo type?") && ammo ? ammo[0] : "none")];
          }
          // Which column holds a quantity: only the clip chart's Drum, for drum magazine size.
          const drum = options.find(([, d]) => d === 'The column headed "Drum"');
          return [k, picked(q.instructions.includes("drum magazine size") && drum ? drum[0] : "none")];
        }),
      ),
    }),
  } as unknown as TypeSafeClient;

  const searched: string[] = [];
  const io: Io = {
    answerLayer: (async (_c: unknown, o: unknown) => o) as unknown as Io["answerLayer"],
    searchPdf: (async (_c: unknown, _pdf: string, o: { question: string }) => {
      searched.push(o.question);
      return o.question.startsWith("Show me the table") ? found(95, weapons) : found(345, clipChart);
    }) as unknown as Io["searchPdf"],
    pageCount: async () => 400,
    pageParagraphs: async () => [],
  };
  const log: string[] = [];
  const ui = { log: (l: string) => log.push(l), trying: () => {}, clear: () => {} };

  const question = "Give me a table of each of the weapons with ammo type and drum magazine size";
  const out = await composeTable(client, "fixture/catalogue.pdf", { ...readDefaults(), question, cache: "off" }, ui, "", io);

  expect(searched).toEqual(["Show me the table of all the weapons", "What is the drum magazine size of each of the weapons?"]);
  expect(log.some((l) => l.startsWith("rows' own cells: ammo type for most rows"))).toBe(true);
  expect(log.some((l) => l.includes("asked again"))).toBe(false);
  expect(out.hit?.answer?.passage?.map((p) => p.table?.cells)).toEqual([
    ["Medium Pistol", "M Pistol", "36"],
    ["Heavy Pistol", "H Pistol", "28"],
    ["Rocket Launcher", "Rocket", "3"],
  ]);
  // Each row asked once for each of the two columns, in the own-cells step only.
  expect(rowAsks).toHaveLength(6);
});
