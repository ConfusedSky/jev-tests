import { describe, expect, test } from "bun:test";
import { answerFrom, answerFromOutline, childrenByParent, countAcross, figuresIn, membershipFromContents, mentions, quantitiesOf, subjectOf } from "./answer";
import type { TypeSafeClient } from "@typesafe-ai/sdk";

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

  // The bug this guards: "witch hunter" contains the entry "Witch", and the
  // contents answered true at p=1.00 without opening a page.
  test("a name that contains an entry is not that entry", () => {
    expect(membershipFromContents("Is witch hunter a class?", HEART)?.text).toBe("false");
    expect(membershipFromContents("Is the junk mage apprentice a class?", HEART)?.text).toBe("false");
  });

  test("takes the statement and the one-of forms too", () => {
    expect(membershipFromContents("Witch is a class.", HEART)?.text).toBe("true");
    expect(membershipFromContents("Is witch one of the classes?", HEART)?.text).toBe("true");
  });

  test("a statement not shaped as membership is a negative for the pages to read", () => {
    expect(membershipFromContents("Heroes choose two classes each.", HEART)).toEqual({
      text: "false",
      parent: "Characters > Classes",
    });
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

describe("subjectOf", () => {
  test.each([
    ["Is witch a class?", "class", "witch"],
    ["Is the Vermissian Knight a class in heart?", "class", "vermissian knight"],
    ["Witch is a class.", "class", "witch"],
    ["Is witch one of the classes?", "classes", "witch"],
    ["Is witch an origin?", "origin", "witch"],
  ])("%s names %s", (q, category, subject) => {
    expect(subjectOf(q, category)).toBe(subject);
  });

  test("has no subject when the statement is not about membership", () => {
    expect(subjectOf("How many classes are there?", "class")).toBeUndefined();
  });
});

describe("answerFromOutline for a statement", () => {
  const none = {} as TypeSafeClient; // membership never reaches the model
  const paths = HEART.flatMap(([parent, kids]) => kids.map((k) => `${parent} > ${k}`));
  const sections = paths.map((path, i) => ({ path, start: i + 1, end: i + 1 }));

  test("a listed entry is final", async () => {
    const r = await answerFromOutline(none, "truth", "Is witch a class?", sections, 0.7);
    expect(r).toEqual({ answer: { text: "true", p: 1 }, parent: "Characters > Classes" });
  });

  test("an unlisted entry points the walk at the section instead", async () => {
    const r = await answerFromOutline(none, "truth", "Is heretic a calling?", sections, 0.7);
    expect(r).toEqual({ parent: "Characters > Callings" });
  });

  test("no matching category leaves the walk unconfined", async () => {
    expect(await answerFromOutline(none, "truth", "Is stress a mechanic?", sections, 0.7)).toBeUndefined();
  });
});

describe("a count above the ceiling", () => {
  test("is asked again with the full range", async () => {
    const client = stubCounts([["over 5", 0.8], ["200", 0.9]]);
    expect(await answerFrom(client, "count", "q", "s", "text", 5)).toEqual({ text: "200", p: 0.9 });
  });

  test("stands when the range was already full", async () => {
    const client = stubCounts([["over 252", 0.8]]);
    expect(await answerFrom(client, "count", "q", "s", "text", 9999)).toEqual({ text: "over 252", p: 0.8 });
  });
});

describe("figuresIn", () => {
  const values = (t: string) => figuresIn(t).map((f) => f.value);

  test("finds digits, with thousands separators and decimals", () => {
    expect(values("Cost: 80 caps, 1,250 total, 2.5 pounds.")).toEqual(["80", "1250", "2.5"]);
  });

  test("reads numbers written as words", () => {
    expect(values("two hundred rads, fifty rads, twenty-one perks, one thousand and five caps")).toEqual(["200", "50", "21", "1005"]);
  });

  test("keeps the first appearance of a repeated figure, with its context", () => {
    const [f] = figuresIn("Weight: 1 pounds. Cost: 1 cap.");
    expect(figuresIn("Weight: 1 pounds. Cost: 1 cap.")).toHaveLength(1);
    expect(f!.context).toContain("Weight: 1 pounds");
  });

  test("ignores a number glued to a word, such as a version", () => {
    expect(values("see v2.5 and p12 and the Mk3")).toEqual([]);
  });

  test("keeps a figure with a unit on its tail", () => {
    // The Fallout weapons table prints "5 CD" as "5C" with the D wrapped.
    expect(values("Combat Rifle 5C D Physical 10mm")).toEqual(["5", "10"]);
  });

  test("a page with no figures yields no choices", () => {
    expect(figuresIn("Nothing here is measured.")).toEqual([]);
  });
});

describe("a stated figure", () => {
  const stub = (choice: string, p: number) =>
    ({
      systemOne: async ({ questions }: { questions: Record<string, { criteria: Record<string, string> }> }) => {
        // The choices are exactly the page's figures plus the refusal. Integer
        // keys come back in numeric order: that is JavaScript, not the text.
        expect(Object.keys(Object.values(questions)[0]!.criteria)).toEqual(["1", "80", "not stated"]);
        return { answers: { q0: { type: "choice", choice, confidence: p, probabilities: { [choice]: p } } } };
      },
    }) as unknown as Parameters<typeof answerFrom>[0];
  const text = "The Umber is a field device. Cost: 80 caps. Weight: 1 pounds.";

  test("is chosen from the figures on the page", async () => {
    expect(await answerFrom(stub("80", 0.9), "number", "How much does the Umber cost?", "s", text, 50)).toEqual({ text: "80", p: 0.9 });
  });

  test("a page without figures is not stated, without asking", async () => {
    const never = { systemOne: async () => { throw new Error("asked"); } } as unknown as Parameters<typeof answerFrom>[0];
    expect(await answerFrom(never, "number", "q", "s", "no figures here", 50)).toEqual({ text: "not stated", p: 1 });
  });
});

describe("quantitiesOf", () => {
  /** Says yes to exactly the listed words. */
  const stub = (yes: string[]) =>
    ({
      systemOne: async ({ questions }: { questions: Record<string, { instructions: string }> }) => ({
        answers: Object.fromEntries(
          Object.entries(questions).map(([k, q]) => {
            const word = /The word "(.*?)"/.exec(q.instructions)![1]!;
            return [k, { type: "noul", noul: yes.includes(word) ? 0.9 : 0.1 }];
          }),
        ),
      }),
    }) as unknown as Parameters<typeof quantitiesOf>[0];

  test("joins adjacent words into one name and splits names at commas", async () => {
    const names = await quantitiesOf(stub(["cost", "weight", "damage", "rating"]), "What is the cost, weight and damage rating of a combat rifle?");
    expect(names).toEqual(["cost", "weight", "damage rating"]);
  });

  test("a question naming no quantity yields none", async () => {
    expect(await quantitiesOf(stub([]), "How does it work?")).toEqual([]);
  });

  test("grammar words never name a quantity, whatever the model says, and they end a name", async () => {
    const names = await quantitiesOf(stub(["What", "cost", "weight", "of"]), "What is the cost and weight of the Lantern?");
    expect(names).toEqual(["cost", "weight"]);
  });
});

describe("several figures at once", () => {
  const text = "The Lantern is a field device. Cost: 53 caps. Weight: 4 pounds.";
  const stub = (picks: Record<string, [string, number]>) =>
    ({
      systemOne: async ({ questions }: { questions: Record<string, { instructions: string }> }) => ({
        answers: Object.fromEntries(
          Object.entries(questions).map(([k, q]) => {
            const name = /is the (.*?) the question/.exec(q.instructions)![1]!;
            const [choice, p] = picks[name]!;
            return [k, { type: "choice", choice, confidence: p, probabilities: { [choice]: p } }];
          }),
        ),
      }),
    }) as unknown as Parameters<typeof answerFrom>[0];
  const ask = (picks: Record<string, [string, number]>) =>
    answerFrom(stub(picks), "number", "q", "s", text, 50, Object.keys(picks));

  test("names each part and reports the least certain", async () => {
    expect(await ask({ cost: ["53", 0.95], weight: ["4", 0.8] })).toEqual({ text: "cost 53, weight 4", p: 0.8 });
  });

  test("a part the page lacks is not stated, and does not drag the confidence", async () => {
    expect(await ask({ cost: ["53", 0.95], damage: ["not stated", 0.6] })).toEqual({ text: "cost 53, damage not stated", p: 0.95 });
  });

  test("nothing stated is a refusal", async () => {
    expect((await ask({ cost: ["not stated", 0.9], damage: ["not stated", 0.6] })).text).toBe("not stated");
  });
});

describe("a count from the contents", () => {
  /** Picks the group whose description names `word`. */
  const picker = (word: string) =>
    ({
      systemOne: async ({ questions }: { questions: { group: { criteria: Record<string, string> } } }) => {
        const choice = Object.entries(questions.group.criteria).find(([, d]) => d.includes(word))![0];
        return { answers: { group: { type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } } } };
      },
    }) as unknown as TypeSafeClient;
  const at = (paths: string[]) => paths.map((path, i) => ({ path, start: i + 1, end: i + 1 }));

  test("counts a section's entries however many pages each takes", async () => {
    const paths = ["Callings", ...["Adventure", "Enlightenment", "Forced", "Heartsong", "Penitent"].map((c) => `Callings > ${c}`)];
    const r = await answerFromOutline(picker("Callings"), "count", "How many callings?", at(paths), 0.7);
    expect(r).toEqual({ answer: { text: "5", p: 0.9 }, parent: "Callings" });
  });

  // The bug this guards: the Fallout rulebook nests 89 of its 94 perks under
  // the first perk, so the perks section lists one perk and six statistics.
  test("reads the pages when an entry holds more entries than its parent", async () => {
    const paths = ["Perks", "Perks > Aquaboy", "Perks > Carry Weight", "Perks > Defense"];
    for (let i = 0; i < 10; i++) paths.push(`Perks > Aquaboy > Perk ${i}`);
    const r = await answerFromOutline(picker("Perks"), "count", "How many perks?", at(paths), 0.7);
    expect(r).toEqual({ parent: "Perks" });
  });
});

describe("countAcross", () => {
  test("leaves out a part below the floor and keeps the confidence of the rest", async () => {
    const a = await countAcross(stubCounts([["1", 0.9], ["37", 0.04], ["1", 0.8]]), "q", "s", ws(3), 60, 0.7);
    expect(a.text).toBe("2");
    expect(a.p).toBeCloseTo(0.8 * (2 / 3));
  });

  // The bug this guards: three sure pages of a 36-page section summed to 3
  // classes at p=0.77, a confident undercount of nine.
  test("a count covering little of the section is not confident", async () => {
    const parts: [string, number][] = [["1", 0.9], ["1", 0.8], ["1", 0.8], ["10", 0.2], ["8", 0.3], ["3", 0.1]];
    const a = await countAcross(stubCounts(parts), "q", "s", ws(6), 60, 0.7);
    expect(a.text).toBe("3");
    expect(a.p).toBeCloseTo(0.8 * (3 / 6));
  });

  test("every part below the floor is not stated", async () => {
    const a = await countAcross(stubCounts([["10", 0.1], ["30", 0.07]]), "q", "s", ws(2), 60, 0.7);
    expect(a.text).toBe("not stated");
  });

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

  test("a part above the full range contributes no number", async () => {
    const a = await countAcross(stubCounts([["3", 0.9], ["over 60", 0.3], ["over 252", 0.3]]), "q", "s", ws(2), 60);
    expect(a.text).toBe("3");
  });

  test("reports each part as it lands", async () => {
    const seen: number[] = [];
    await countAcross(stubCounts([["2", 0.9], ["3", 0.9]]), "q", "s", ws(2), 60, 0, (_p, _a, _c, running) =>
      seen.push(running),
    );
    expect(seen).toEqual([2, 5]);
  });
});
