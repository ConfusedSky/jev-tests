import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chunks, pageSim } from "./embed";

test("a page over the chunk size is cut into equal parts, and an empty page into none", () => {
  expect(chunks("  a \n b ")).toEqual(["a b"]);
  expect(chunks(" \n ")).toEqual([]);
  const parts = chunks("x".repeat(13000));
  expect(parts.map((p) => p.length)).toEqual([4334, 4334, 4332]);
});

test("pages are embedded once and scored by their best chunk", async () => {
  const dir = await mkdtemp(`${tmpdir()}/jev-embed-`);
  let embedded = 0;
  // The question points along x; a page's chunk "y…" along y.
  const embed = async (texts: string[]) => {
    embedded += texts.length;
    return texts.map((t) => (t.startsWith("Instruct") ? [1, 0] : t.startsWith("y") ? [0, 1] : [1, 1]));
  };
  const sim = pageSim("fixture/catalogue.pdf", "q", dir, embed);
  const pages = [
    { page: 1, text: "yes" },
    { page: 2, text: `${"a".repeat(5000)}${"y".repeat(7000)}` },
    { page: 3, text: "" },
  ];
  const cos = await sim(pages);
  expect(cos[0]).toBeCloseTo(0);
  expect(cos[1]).toBeCloseTo(Math.SQRT1_2);
  expect(cos[2]).toBe(-1);
  const before = embedded;
  await pageSim("fixture/catalogue.pdf", "q", dir, embed)(pages);
  expect(embedded - before).toBe(1); // only the new question
});
