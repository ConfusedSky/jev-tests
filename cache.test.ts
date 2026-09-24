import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { CACHE_MODELS, queryText, rankingCache, richText, subjectText, unready, type Embed } from "./cache";
import type { Ranked } from "./shared";

const qwen = CACHE_MODELS["qwen3-4b"]!;
const small = CACHE_MODELS["3-small"]!;
const ranked = (name: string, score = 3): Ranked => ({ name, list: "candidates", index: 0, score, confidence: 1, reason: "" });
const ranking = { all: [ranked("Equipment > Chems > RadAway"), ranked("Survival > Radiation"), ranked("Equipment"), ranked("Combat", 1)], ex: [] };
const pdf = Bun.fileURLToPath(new URL("fixture/manual.pdf", import.meta.url));

/** Embeds each text to the vector `vectors` names by a word it holds, counting calls. */
function fake(vectors: [string, number[]][]) {
  const calls: string[][] = [];
  const embed: Embed = async (texts) => {
    calls.push(texts);
    return texts.map((t) => vectors.find(([w]) => t.includes(w))?.[1] ?? [0, 0, 1]);
  };
  return { embed, calls };
}

async function withDir(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(`${tmpdir()}/jev-cache-`);
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("the texts embedded", () => {
  test("are the ones the bars were measured on", () => {
    expect(queryText(qwen, "How is radiation treated?")).toBe(
      "Instruct: Given a question about a tabletop rulebook, retrieve cached questions answered by the same rulebook sections\nQuery: How is radiation treated?",
    );
    expect(queryText(small, "How is radiation treated?")).toBe("How is radiation treated?");
    expect(richText("How is radiation treated?", ["A", "B", "C", "D"])).toBe("How is radiation treated?\nSections: A; B; C");
    expect(subjectText(["radiation", "sickness"])).toBe("radiation, sickness");
  });
});

describe("rankingCache", () => {
  test("an empty cache has nothing, and asks no embedding", async () =>
    withDir(async (dir) => {
      const { embed, calls } = fake([]);
      expect(await rankingCache(qwen, embed, dir, "How is radiation treated?", ["radiation"]).lookup(pdf)).toBeUndefined();
      expect(calls).toEqual([]);
    }));

  test("a question close enough to a stored one walks its ranking; one that is not does not", async () =>
    withDir(async (dir) => {
      // "cure" and "treated" point the same way; "perks" does not.
      const { embed } = fake([
        ["cure", [1, 0, 0]],
        ["treated", [0.9, 0.1, 0]],
        ["perks", [0, 1, 0]],
      ]);
      await rankingCache(qwen, embed, dir, "How is radiation treated?", []).store(pdf, ranking);
      const hit = await rankingCache(qwen, embed, dir, "How do I cure radiation sickness?", []).lookup(pdf);
      expect(hit?.entry.question).toBe("How is radiation treated?");
      expect(hit?.entry.all).toEqual(ranking.all);
      expect(hit?.entry.top).toEqual(["Equipment > Chems > RadAway", "Survival > Radiation", "Equipment"]);
      expect(hit?.subject).toBe(-1);
      expect(await rankingCache(qwen, embed, dir, "How many perks are there?", []).lookup(pdf)).toBeUndefined();
    }));

  test("a subject as close as the bar is a hit however far apart the questions are", async () =>
    withDir(async (dir) => {
      const { embed } = fake([
        ["Query: What is the damage", [0, 1, 0]],
        ["Sections", [1, 0, 0]],
        ["small gun", [0, 0, 1]],
      ]);
      await rankingCache(qwen, embed, dir, "What is the cost of a combat rifle?", ["small gun"]).store(pdf, ranking);
      const hit = await rankingCache(qwen, embed, dir, "What is the damage of every small gun?", ["small gun"]).lookup(pdf);
      expect(hit).toMatchObject({ whole: 0, subject: 1 });
    }));

  test("a question stored again replaces its entry", async () =>
    withDir(async (dir) => {
      const { embed } = fake([]);
      const c = rankingCache(qwen, embed, dir, "How is radiation treated?", []);
      await c.store(pdf, ranking);
      await c.store(pdf, { all: [ranked("Survival")], ex: [] });
      const files = [...new Bun.Glob("*/rankings.json").scanSync(dir)];
      const entries = (await Bun.file(`${dir}/${files[0]}`).json()) as { top: string[] }[];
      expect(entries.map((e) => e.top)).toEqual([["Survival"]]);
    }));

  test("each model keeps its own embeddings of the rankings, made the first time it looks", async () =>
    withDir(async (dir) => {
      const { embed } = fake([["treated", [1, 0, 0]]]);
      await rankingCache(qwen, embed, dir, "How is radiation treated?", []).store(pdf, ranking);
      const other = fake([["treated", [1, 0, 0]]]);
      await rankingCache(small, other.embed, dir, "How is radiation treated?", []).lookup(pdf);
      await rankingCache(small, other.embed, dir, "How is radiation treated?", []).lookup(pdf);
      // The stored entry is embedded once for 3-small, then read back; each lookup embeds its own question.
      expect(other.calls.filter((c) => c.some((t) => t.includes("Sections")))).toHaveLength(1);
      expect([...new Bun.Glob("*/embeddings-*.json").scanSync(dir)].map((f) => f.split("/")[1])).toEqual(["embeddings-3-small.json"]);
    }));
});

describe("unready", () => {
  const answering = (models: string[]) => (async () => new Response(JSON.stringify({ models: models.map((name) => ({ name })) }))) as unknown as typeof fetch;

  test("Ollama not answering says to start it or pass --cache off", async () => {
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const why = await unready(qwen, down);
    expect(why).toContain("`ollama serve`");
    expect(why).toContain("--cache off");
  });

  test("Ollama without the model says to pull it", async () => {
    expect(await unready(qwen, answering(["gemma4:26b"]))).toContain("`ollama pull qwen3-embedding:4b`");
  });

  test("Ollama with the model is ready", async () => {
    expect(await unready(qwen, answering(["qwen3-embedding:4b"]))).toBeUndefined();
  });
});
