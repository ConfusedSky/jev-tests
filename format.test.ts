import { describe, expect, test } from "bun:test";
import { elideMiddle, elidePath, render } from "./format";
import type { Ranked } from "./shared";

const row = (name: string, score = 1, reason = "Unrelated to the question"): Ranked => ({
  name,
  score,
  confidence: 0.5,
  reason,
});

describe("elideMiddle", () => {
  test("leaves anything that fits alone", () => {
    expect(elideMiddle("notes.txt", 20)).toBe("notes.txt");
  });

  test("cuts to exactly the requested width", () => {
    expect(elideMiddle("a".repeat(40), 10)).toHaveLength(10);
  });

  test("keeps both ends and marks the cut", () => {
    expect(elideMiddle("abcdefghij", 5)).toBe("ab…ij");
  });
});

describe("elidePath", () => {
  test("spends the cut on directories, never the filename", () => {
    const out = elidePath("some/very/long/directory/chain/report.pdf", 20);
    expect(out).toEndWith("/report.pdf");
    expect(out).toHaveLength(20);
  });

  test("falls back to eliding the basename when it alone overflows", () => {
    const out = elidePath("dir/" + "x".repeat(60) + ".pdf", 20);
    expect(out).toHaveLength(20);
    expect(out).toContain("…");
    expect(out).not.toContain("/");
  });

  test("a bare filename has no directory budget to spend", () => {
    expect(elidePath("grocery-list.txt", 30)).toBe("grocery-list.txt");
  });
});

describe("render", () => {
  test("aligns the reason column across rows of differing name length", () => {
    const lines = render([row("a.md", 3), row("a-much-longer-name.md", 2)], 120);
    const at = lines.map((l) => l.indexOf("Unrelated"));
    expect(at[0]).toBe(at[1]!);
  });

  test("never exceeds the terminal width", () => {
    const lines = render([row("x".repeat(200), 3), row("y.md", 1)], 100);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(100);
  });

  test("scores print to two decimals, right-aligned", () => {
    expect(render([row("a.md", 3)], 120)[0]).toStartWith("3.00  ");
    expect(render([row("a.md", 0.5)], 120)[0]).toStartWith("0.50  ");
  });

  test("piped output stays tab separated for cut and awk", () => {
    const [line] = render([row("a.md", 2.5, "why")]);
    expect(line).toBe("2.50\ta.md\twhy");
  });
});
