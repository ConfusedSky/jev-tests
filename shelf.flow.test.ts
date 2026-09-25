import { expect, test } from "bun:test";
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import type { ReadOpts } from "./cli";
import { NA } from "./compose";
import type { Hit, Outcome } from "./pdf";
import { terms } from "./search";
import { acrossTable, findDefaults, findIn, type AcrossIo, type FindIo, type FindOpts } from "./shelf";

const ui = (log: string[]) => ({ log: (l: string) => log.push(l), trying: () => {}, clear: () => {} });
const hit = (pdf: string, section: string, text: string): Hit => ({ pdf, section, page: 12, p: 0.9, text: "", answer: { text, p: 0.95 } });
const none = { hits: [], tried: [], rejected: [], dropped: [], opened: 1, above: 1, considered: 1 };

test("each cell asks its own question over the whole shelf, under a hard floor; a cell read as a table is walked as a passage", async () => {
  const walks: { question: string; kind: string | undefined; hard: boolean }[] = [];
  const io: AcrossIo = {
    answerLayer: (async (_c: unknown, o: ReadOpts) => ({
      ...o,
      // The outer table's kind must not reach a cell.
      kind: o.kind ?? (o.question.startsWith("how does") ? "table" : o.question.startsWith("how many") ? "count" : "passage"),
    })) as unknown as AcrossIo["answerLayer"],
    findIn: (async (_c: unknown, _paths: string[], s: FindOpts, _ui: unknown, { hard = false } = {}) => {
      walks.push({ question: s.question, kind: s.kind, hard });
      if (s.question.endsWith("in Fallout?")) return none;
      const h = hit("book.pdf", "Rules > Skills", s.kind === "count" ? "9" : "");
      return { ...none, hit: h, hits: [h] };
    }) as unknown as AcrossIo["findIn"],
  };
  const log: string[] = [];
  const o = { ...findDefaults(), kind: "table" as const, hits: 1 };
  const t = await acrossTable({} as TypeSafeClient, ["a.pdf", "b.pdf"], o, ["Heart", "Fallout"], ["how many skills are there", "how does healing work"], ui(log), io);

  expect(walks).toEqual([
    { question: "how many skills are there in Heart?", kind: "count", hard: true },
    { question: "how does healing work in Heart?", kind: "passage", hard: true },
    { question: "how many skills are there in Fallout?", kind: "count", hard: true },
    { question: "how does healing work in Fallout?", kind: "passage", hard: true },
  ]);
  expect(t.cells.map((line) => line.map((c) => c.text))).toEqual([
    ["9", "p.12 Skills"],
    [NA, NA],
  ]);
  expect(log.filter((l) => l.startsWith("  a cell holds no table"))).toHaveLength(2);
  // Each cell opens with its header and closes with its sum at the same depth.
  expect(log.filter((l) => /^\S.*…$/.test(l))).toHaveLength(4);
  expect(log.filter((l) => /^\S.*  in /.test(l))).toHaveLength(4);
});

test("under a hard floor a file whose name falls below it is never opened, and no excerpt is read", async () => {
  // Heart's name clears the floor; the manual's does not.
  const client = {
    systemOne: async ({ state, questions }: { state: { candidates: string[] }; questions: Record<string, unknown> }) => ({
      answers: Object.fromEntries(
        Object.keys(questions).map((id) => {
          const score = state.candidates[Number(id.replace("candidates", ""))]!.includes("heart") ? 2.5 : 0.5;
          return [id, { score, confidence: 0.9, probabilities: [0.1, 0.1, 0.4, 0.4] }];
        }),
      ),
    }),
  } as unknown as TypeSafeClient;
  const opened: string[] = [];
  const io: FindIo = {
    searchPdf: (async (_c: unknown, pdf: string) => {
      opened.push(pdf);
      return { hits: [], tried: [], rejected: [], dropped: [] } satisfies Outcome;
    }) as unknown as FindIo["searchPdf"],
    composeTable: (async () => {
      throw new Error("no table here");
    }) as unknown as FindIo["composeTable"],
  };
  const log: string[] = [];
  const question = "how many skills are there in Heart?";
  const search = { ...findDefaults(), question, kind: "passage" as const, terms: terms(question, ["skills"]) };
  const fixture = (f: string) => Bun.fileURLToPath(new URL(`fixture/${f}`, import.meta.url));
  const heart = fixture("heart.pdf");
  const r = await findIn(client, [heart, fixture("manual.pdf")], search, ui(log), { hard: true }, io);

  expect(opened).toEqual([heart]);
  expect(r.opened).toBe(1);
  expect(log[0]).toStartWith("ranked 2 paths and 0 excerpts");
});

test("an empty PDF whose name clears the floor is logged and skipped, and the walk goes on to the next", async () => {
  const client = {
    systemOne: async ({ state, questions }: { state: { candidates: string[] }; questions: Record<string, unknown> }) => ({
      answers: Object.fromEntries(
        Object.keys(questions).map((id) => {
          const score = state.candidates[Number(id.replace("candidates", ""))]!.includes("taxes") ? 2.9 : 2.0;
          return [id, { score, confidence: 0.9, probabilities: [0.1, 0.1, 0.4, 0.4] }];
        }),
      ),
    }),
  } as unknown as TypeSafeClient;
  const opened: string[] = [];
  const io: FindIo = {
    searchPdf: (async (_c: unknown, pdf: string) => {
      opened.push(pdf);
      return { hits: [], tried: [], rejected: [], dropped: [] } satisfies Outcome;
    }) as unknown as FindIo["searchPdf"],
    composeTable: (async () => {
      throw new Error("no table here");
    }) as unknown as FindIo["composeTable"],
  };
  const log: string[] = [];
  const fixture = (f: string) => Bun.fileURLToPath(new URL(`fixture/${f}`, import.meta.url));
  const [taxes, manual] = [fixture("taxes-2025.pdf"), fixture("manual.pdf")];
  expect(Bun.file(taxes).size).toBe(0);
  const search = { ...findDefaults(), question: "How much tax is owed for 2025?", kind: "number" as const };
  const r = await findIn(client, [taxes, manual], search, ui(log), {}, io);

  expect(opened).toEqual([manual]);
  expect(r.opened).toBe(1);
  expect(log).toContain(`2.90  ${taxes}  --  empty file, skipped`);
});
