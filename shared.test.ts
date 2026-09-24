import { describe, expect, test } from "bun:test";
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { counted, DOLLARS_PER_MILLION_IN, rank, rankTitles, snapshot, spent, split } from "./shared";

/** Records each call's state and scores an item by its label's digit. */
function client(calls: unknown[]) {
  return {
    systemOne: async ({ state, questions }: { state: Record<string, unknown>; questions: Record<string, { instructions: string }> }) => {
      calls.push(state);
      return {
        answers: Object.fromEntries(
          Object.entries(questions).map(([k, q]) => {
            const label = /\("(.*)"\) answers/.exec(q.instructions)![1]!;
            return [k, { score: Number(/\d/.exec(label)![0]), confidence: 1, legend: {}, probabilities: {} }];
          }),
        ),
      };
    },
  } as unknown as Parameters<typeof rank>[0];
}

describe("rank", () => {
  test("two lists share a call, each under its own key, and come back as one order", async () => {
    const calls: unknown[] = [];
    const out = await rank(
      client(calls),
      "q",
      [
        { key: "sections", noun: "section", items: [{ label: "a1", value: "a1" }, { label: "a3", value: "a3" }] },
        { key: "excerpts", noun: "page excerpt", items: [{ label: "p.2 e2", value: { page: 2, content: "e2" } }] },
      ],
      40,
    );
    expect(calls).toEqual([{ question: "q", sections: ["a1", "a3"], excerpts: [{ page: 2, content: "e2" }] }]);
    expect(out.map((r) => [r.list, r.index, r.score])).toEqual([["sections", 1, 3], ["excerpts", 0, 2], ["sections", 0, 1]]);
  });

  test("a chunk holds only its own slice of each list, and the index still points into the whole list", async () => {
    const calls: unknown[] = [];
    const items = ["a1", "a2", "a3"].map((label) => ({ label, value: label }));
    const out = await rank(client(calls), "q", [{ key: "sections", noun: "section", items }], 2);
    expect(calls).toEqual([{ question: "q", sections: ["a1", "a2"] }, { question: "q", sections: ["a3"] }]);
    expect(out.map((r) => r.index)).toEqual([2, 1, 0]);
  });

  test("rankTitles keeps the names under `candidates`", async () => {
    const calls: unknown[] = [];
    await rankTitles(client(calls), "q", ["x1"], 40, "file named");
    expect(calls).toEqual([{ question: "q", candidates: ["x1"] }]);
  });
});

describe("tokens", () => {
  test("a counted client adds each call's tokens, and a step says what it spent at jev's input price", async () => {
    const client = counted({
      systemOne: async () => ({ answers: {}, usage: { input_tokens: 1_000_000, output_tokens: 40 } }),
    } as unknown as TypeSafeClient);
    const before = snapshot();
    await client.systemOne({ state: {}, questions: {} } as never);
    await client.systemOne({ state: {}, questions: {} } as never);
    expect(spent(before)).toBe(`2,000,000 tokens in, 80 out, $${(2 * DOLLARS_PER_MILLION_IN).toFixed(5)}`);
    expect(split(before)).toContain("; 2,000,000 tokens in, 80 out, $0.08400)");
  });

  test("a step that asked jev nothing says nothing of tokens", () => {
    expect(spent(snapshot())).toBe("");
    expect(split(snapshot())).not.toContain("tokens");
  });
});
