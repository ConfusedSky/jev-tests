import { describe, expect, test } from "bun:test";
import { childrenByParent, countAcross, membershipFromContents, mentions } from "./answer";

const HEART: [string, string[]][] = [
  ["Characters", ["Callings", "Classes"]],
  ["Characters > Callings", ["The Heart Calling", "The Enlightenment Calling", "The Vermissian Calling"]],
  ["Characters > Classes", ["Cleaver", "Deadwalker", "Heretic", "Junk Mage", "Vermissian Knight", "Witch"]],
];

describe("mentions", () => {
  test("matches whole words only", () => {
    expect(mentions("is witch a class?", "Witch")).toBe(true);
    expect(mentions("is witchcraft a class?", "Witch")).toBe(false);
  });

  // The bug this guards: "knight" matched because "Vermissian Knight" contains it.
  test("a longer entry is not named by a fragment of it", () => {
    expect(mentions("is knight a class?", "Vermissian Knight")).toBe(false);
    expect(mentions("is vermissian knight a class?", "Vermissian Knight")).toBe(true);
  });

  test("ignores case, punctuation and a leading the", () => {
    expect(mentions("is THE Vermissian Calling a calling?", "The Vermissian Calling")).toBe(true);
    expect(mentions("is the vermissian calling a calling?", "Vermissian Calling")).toBe(true);
  });

  test("an empty phrase matches nothing", () => {
    expect(mentions("anything", "")).toBe(false);
  });
});

describe("childrenByParent", () => {
  test("groups each path under its parent", () => {
    expect(childrenByParent(["A", "A > B", "A > C", "A > B > D"])).toEqual(
      new Map([
        ["A", ["B", "C"]],
        ["A > B", ["D"]],
      ]),
    );
  });

  test("a top level path has no parent to sit under", () => {
    expect(childrenByParent(["Intro"])).toEqual(new Map());
  });
});

describe("membershipFromContents", () => {
  test("an entry listed under the claimed section is a member", () => {
    expect(membershipFromContents("Is witch a class in heart?", HEART)).toEqual({
      text: "true",
      parent: "Characters > Classes",
    });
  });

  test("matches a plural section name from a singular category word", () => {
    // "class" has to reach "Classes"; singular() used to leave "Clas".
    expect(membershipFromContents("Is cleaver a class?", HEART)?.text).toBe("true");
    expect(membershipFromContents("Is the heart calling a calling?", HEART)?.text).toBe("true");
  });

  test("an entry of another section is not a member of this one", () => {
    expect(membershipFromContents("Is heretic a calling in heart?", HEART)).toEqual({
      text: "false",
      parent: "Characters > Callings",
    });
  });

  test("a fragment of an entry name is not a member", () => {
    expect(membershipFromContents("Is knight a class?", HEART)?.text).toBe("false");
    expect(membershipFromContents("Is mage a class?", HEART)?.text).toBe("false");
  });

  test("declines when no section names the claimed category", () => {
    expect(membershipFromContents("Is stress a mechanic?", HEART)).toBeUndefined();
  });

  test("declines when the category is ambiguous", () => {
    const groups: [string, string[]][] = [
      ["Book > Classes", ["Witch"]],
      ["Appendix > Classes", ["Cleaver"]],
    ];
    expect(membershipFromContents("Is witch a class?", groups)).toBeUndefined();
  });
});

/** Returns each queued choice in turn, so a walk's arithmetic can be checked offline. */
function stubCounts(answers: [string, number][]) {
  let i = 0;
  return {
    systemOne: async () => {
      const [choice, p] = answers[i++]!;
      return { answers: { count: { type: "choice", choice, confidence: p, probabilities: { [choice]: p } } } };
    },
  } as unknown as Parameters<typeof countAcross>[0];
}

const ws = (n: number) => Array.from({ length: n }, (_, i) => ({ page: i + 1, text: "x" }));

describe("countAcross", () => {
  test("adds the parts up", async () => {
    const a = await countAcross(stubCounts([["10", 0.9], ["10", 0.95], ["10", 0.8]]), "q", "s", ws(3), 60);
    expect(a.text).toBe("30");
  });

  test("reports the least certain part that contributed", async () => {
    const a = await countAcross(stubCounts([["4", 0.9], ["6", 0.42]]), "q", "s", ws(2), 60);
    expect(a).toEqual({ text: "10", p: 0.42 });
  });

  // A long list has windows holding none of it; that is expected, not doubt.
  test("a window listing none neither adds nor lowers confidence", async () => {
    const a = await countAcross(stubCounts([["7", 0.9], ["not stated", 0.05], ["0", 0.1]]), "q", "s", ws(3), 60);
    expect(a).toEqual({ text: "7", p: 0.9 });
  });

  test("a part above the ceiling contributes no number", async () => {
    const a = await countAcross(stubCounts([["3", 0.9], ["over 60", 0.3]]), "q", "s", ws(2), 60);
    expect(a.text).toBe("3");
  });

  test("reports each part as it lands", async () => {
    const seen: number[] = [];
    await countAcross(stubCounts([["2", 0.9], ["3", 0.9]]), "q", "s", ws(2), 60, (_p, _a, running) =>
      seen.push(running),
    );
    expect(seen).toEqual([2, 5]);
  });
});
