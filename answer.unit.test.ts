import { describe, expect, test } from "bun:test";
import { answerFrom, answerFromOutline, bestRun, bestRuns, cellsIn, childrenByParent, claimVerdict, countAcross, countParts, figureLimit, figuresIn, membershipFromContents, mentions, nameKey, readPassage, readQuestion, subjectOf, unitsOf } from "./answer";

const fixture = (name: string) => Bun.fileURLToPath(new URL(`fixture/${name}`, import.meta.url));
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

/**
 * A window's cells and the noul each gets back, so a walk's arithmetic can be
 * checked offline: `[n, p]` is a window listing n entries, each at p, and a
 * longer array gives each cell its own noul; the rest of the cells say no.
 * Windows are counted in order.
 */
function stubCells(answers: ([number, number] | number[])[]) {
  let call = 0;
  return {
    systemOne: async ({ questions }: { questions: Record<string, unknown> }) => {
      const a = answers[call++]!;
      const ps = a.length === 2 && a[0]! >= 1 && a[1]! < 1 ? Array.from({ length: a[0]! }, () => a[1]!) : a;
      const keys = Object.keys(questions);
      return { answers: Object.fromEntries(keys.map((k, i) => [k, { type: "noul", noul: ps[i] ?? 0.05 }])) };
    },
  } as unknown as Parameters<typeof countAcross>[0];
}

/** Windows of 40 entry lines each, named apart, and a line of prose, so every window has cells to ask about. */
const ws = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    page: i + 1,
    text: [...Array.from({ length: 40 }, (_, j) => `Entry ${i + 1}-${j}`), "Some prose, for context."].join("\n"),
  }));

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

describe("cellsIn", () => {
  test("a list inline in prose yields each name", () => {
    const cells = cellsIn("A vault dweller has seven skills: Athletics, Barter, Lockpick, Medicine, Melee, Science and Survival. Each skill is");
    expect(cells).toEqual(expect.arrayContaining(["Athletics", "Barter", "Lockpick", "Medicine", "Melee", "Science", "Survival"]));
  });

  test("a list one per line yields the name before the comma, not the clause after it", () => {
    expect(cellsIn("      The Cleave, a berserker who fights with fury.\n      The Witch, who bargains with the powers below.")).toEqual([
      "Cleave",
      "Witch",
    ]);
  });

  test("a -layout table row or two-column line splits at the gutter", () => {
    expect(cellsIn("Gunslinger      Awareness\nCombat Rifle    5C    Physical")).toEqual(["Gunslinger", "Awareness", "Combat Rifle", "Physical"]);
  });

  // The bug this guards: "the Cleaver, the Deadwalker, the Deep Apiarist" cut
  // to nothing, and the page counted one class at p=1.00.
  test("a name behind an article is a name", () => {
    expect(cellsIn("The classes are the Cleaver, the Deadwalker, the Deep Apiarist and the Witch.")).toEqual([
      "Cleaver",
      "Deadwalker",
      "Deep Apiarist",
      "Witch",
    ]);
  });

  test("drops prose too long to be a name, cells not starting with a capital, and repeats", () => {
    expect(cellsIn("Aegis\n20\naegis\nThe Bulwark fits in any standard pack\n" + "A".repeat(61))).toEqual(["Aegis"]);
  });
});

describe("unitsOf", () => {
  const plain = (text: string, heading = false) => ({ heading, text, style: " ".repeat(text.length), lines: [] });

  test("a table's row is one unit whatever its stops", () => {
    const row = { heading: false, table: { heads: ["Weapon", "Cost"], cells: ["Dr. Gun", "5. 000eb"] }, text: '{"Weapon":"Dr. Gun","Cost":"5. 000eb"}', style: "", lines: [] };
    expect(unitsOf([row]).map((u) => u.text)).toEqual([row.text]);
  });

  test("a list marker is not a sentence of its own", () => {
    expect(unitsOf([plain("2. PICK WEAPONS. The player declares.")]).map((u) => u.text)).toEqual(["2. PICK WEAPONS.", "The player declares."]);
  });

  test("splits a paragraph at sentence ends and keeps each sentence's weights and place", () => {
    const para = { heading: false, text: "RadAway heals. RadX prevents.", style: "bbbbbbb" + " ".repeat(22), lines: [] };
    expect(unitsOf([para])).toEqual([
      { para: 0, text: "RadAway heals.", style: "bbbbbbb       ", start: 0, end: 14 },
      { para: 0, text: "RadX prevents.", style: " ".repeat(14), start: 15, end: 29 },
    ]);
  });

  test("a heading is one unit, and a lowercase continuation after a stop is not a new sentence", () => {
    expect(unitsOf([plain("TAGS", true), plain("Costs D6. e.g. more.")]).map((u) => u.text)).toEqual(["TAGS", "Costs D6. e.g. more."]);
  });
});

describe("bestRuns", () => {
  test("every run clearing the minimum, in order, the aside between them left out", () => {
    const ps = [0.9, 0.8, 0.3, 0.4, 0.9, 0.95, 0.2, 0.7, 0.1];
    expect(bestRuns(ps, 0.65, 0.25)).toEqual([{ start: 0, end: 2 }, { start: 4, end: 6 }]);
  });

  test("a lone sentence just over the bar is not a run of its own", () => {
    expect(bestRuns([0.9, 0.9, 0.1, 0.7], 0.65, 0.25)).toEqual([{ start: 0, end: 2 }]);
  });

  test("nothing over the bar is no run", () => {
    expect(bestRuns([0.5, 0.6], 0.65, 0.25)).toEqual([]);
  });
});

describe("bestRun", () => {
  test("is the run with the largest total above the bar", () => {
    expect(bestRun([0.1, 0.9, 0.9, 0.2, 0.9], 0.65)).toEqual({ start: 1, end: 3 });
  });

  // The bug this guards: the longest run of yeses cut the RadAway entry's
  // heading off from its text over one sentence at 0.43.
  test("bridges a dip the sentences around it outweigh", () => {
    expect(bestRun([0.94, 0.9, 0.43, 0.62, 0.79, 0.96, 0.87, 0.81, 0.49], 0.65)).toEqual({ start: 0, end: 8 });
  });

  test("leaves out a tail that only just clears even odds", () => {
    expect(bestRun([0.95, 0.95, 0.67, 0.58, 0.62], 0.65)).toEqual({ start: 0, end: 3 });
  });

  test("is nothing when no sentence rises above the bar", () => {
    expect(bestRun([0.1, 0.6, 0.3], 0.65)).toBeUndefined();
  });
});

describe("a passage", () => {
  const plain = (text: string, heading = false) => ({ heading, text, style: " ".repeat(text.length), lines: [] });
  const box = (y: number, start: number, end: number) => ({ page: 3, x0: 72, y0: y, x1: 300, y1: y + 12, start, end });
  const page = [
    plain("Chapter III: Radiation", true),
    plain("Radiation damage is permanent until treated with RadAway. A dweller carries a dosimeter."),
    {
      heading: false,
      text: "RadAway is stocked in the clinic. RadX reduces rads absorbed.",
      style: "bbbbbbb" + " ".repeat(54),
      lines: [box(130, 0, 33), box(142, 34, 61)],
    },
  ];
  /** Answers each sentence question by the noul listed for the sentence's text. */
  const stub = (nouls: Record<string, number>) =>
    ({
      systemOne: async ({ questions }: { questions: Record<string, { instructions: { sentence: string } }> }) => ({
        answers: Object.fromEntries(Object.entries(questions).map(([k, q]) => [k, { type: "noul", noul: nouls[q.instructions.sentence] ?? 0.05 }])),
      }),
    }) as unknown as Parameters<typeof readPassage>[0];

  test("is the sentences that answer, their paragraph put back together with its weights, as sure as they are on average", async () => {
    const a = await readPassage(stub({ "RadAway is stocked in the clinic.": 0.9, "RadX reduces rads absorbed.": 0.8 }), "q", "s", page);
    expect(a.text).toBe("RadAway is stocked in the clinic. RadX reduces rads absorbed.");
    expect(a.passage).toEqual([
      { heading: false, text: "RadAway is stocked in the clinic. RadX reduces rads absorbed.", style: "bbbbbbb" + " ".repeat(54), lines: [box(130, 0, 33), box(142, 34, 61)] },
    ]);
    expect(a.pages).toEqual([3]);
    expect(a.p).toBeCloseTo(0.85);
  });

  test("carries only the lines the chosen sentences sit on, and names their page", async () => {
    const a = await readPassage(stub({ "RadX reduces rads absorbed.": 0.9 }), "q", "s", page);
    expect(a.passage?.[0]?.lines).toEqual([box(142, 34, 61)]);
    expect(a.pages).toEqual([3]);
  });

  test("a heading is a unit of its own and keeps its line", async () => {
    const a = await readPassage(stub({ "Chapter III: Radiation": 0.8, "Radiation damage is permanent until treated with RadAway.": 0.9 }), "q", "s", page);
    expect(a.text).toBe("Chapter III: Radiation\nRadiation damage is permanent until treated with RadAway.");
    expect(a.passage?.map((p) => p.heading)).toEqual([true, false]);
  });

  // The bug this guards: Necromunda's phases of a round start at the foot of
  // one page and go on at the top of the next, and the passage stopped short.
  test("a passage grows onto the next page when that page holds a run of its own, and only its sentences are asked", async () => {
    const asked: string[] = [];
    const nouls = { "RadX reduces rads absorbed.": 0.9, "Take one dose per day.": 0.9, "Unrelated.": 0.1 };
    const client = stub(nouls);
    const spy = {
      systemOne: async (r: { questions: Record<string, { instructions: { sentence: string } }> }) => {
        asked.push(...Object.values(r.questions).map((q) => q.instructions.sentence));
        return (client.systemOne as (x: unknown) => Promise<unknown>)(r);
      },
    } as unknown as typeof client;
    const next = [plain("Take one dose per day. Unrelated.")];
    const seen: string[] = [];
    const more = async () => (seen.push("after"), seen.length === 1 ? next : []);
    const a = await readPassage(spy, "q", "s", page, more);
    expect(a.text).toBe("RadX reduces rads absorbed.\nTake one dose per day.");
    expect(asked.filter((s) => s === "Take one dose per day.")).toHaveLength(1);
    expect(asked.filter((s) => s === "RadX reduces rads absorbed.")).toHaveLength(1);
  });

  test("a table's row keeps its heads and cells, so a terminal can print it as a grid", async () => {
    const table = { heads: ["Chem", "Cost"], cells: ["RadAway", "80"] };
    const row = { ...plain('{"Chem":"RadAway","Cost":"80"}'), table };
    const a = await readPassage(stub({ [row.text]: 0.9 }), "q", "s", [...page, row]);
    expect(a.passage?.[0]?.table).toEqual(table);
  });

  test("a page with no sentence of the answer is not stated", async () => {
    expect(await readPassage(stub({}), "q", "s", page)).toEqual({ text: "not stated", p: 1 });
  });
});

describe("nameKey", () => {
  // The bug this guards: the Fallout skills pages counted "REPAIR" and
  // "Repair skill" as two skills, and "MELEE WEAPONS" and "The Melee Weapons skill".
  test("drops the article and the kind-word, so a mention and its headline are one name", () => {
    expect(nameKey("The Melee Weapons skill", "skills")).toBe("melee weapons");
    expect(nameKey("REPAIR", "skills")).toBe("repair");
    expect(nameKey("Repair skill", "skills")).toBe("repair");
    expect(nameKey("Theme Kit", "theme kits")).toBe("theme");
    expect(nameKey("Cleaver Class", "classes")).toBe("cleaver");
    expect(nameKey("Repair skill.", "skills")).toBe("repair");
    expect(nameKey("Wild Ability", "abilities")).toBe("wild");
  });

  test("leaves a name alone when no kind is known", () => {
    expect(nameKey("The Witch", "")).toBe("witch");
  });
});

describe("countParts", () => {
  test("takes the text's scraps when the page sets only a title apart", async () => {
    const { parts, fallback } = await countParts({ text: "Skills: Athletics, Barter and Survival.", pdf: fixture("manual.pdf"), page: 1 });
    expect(fallback).toBeUndefined();
    expect(parts).toHaveLength(1);
    expect(parts[0]!.cells.map((c) => c.text)).toEqual(expect.arrayContaining(["Athletics", "Barter", "Survival"]));
  });

  test("takes the page's styled runs when it has them, with the scraps to fall back on", async () => {
    const { parts, fallback } = await countParts({ text: "Gadgets: Aegis.", pdf: fixture("gadgets.pdf"), page: 1 });
    expect(parts[0]!.cells.map((c) => c.text)).toEqual(expect.arrayContaining(["Aegis", "Bulwark", "Cinder"]));
    expect(parts[0]!.text).toContain("Aegis");
    expect(fallback?.[0]?.cells.map((c) => c.text)).toEqual(["Gadgets", "Aegis"]);
  });
});

describe("a count off the page", () => {
  const count = (cells: [number, number] | number[]) => answerFrom(stubCells([cells]), "count", "How many entries?", "s", ws(1)[0]!.text);

  test("is the number of cells the model calls an entry", async () => {
    expect(await count([7, 0.8])).toEqual({ text: "7", p: 1 });
  });

  // Six entries, three of them barely: the count is as sure as the share of
  // cells decided clearly, not as the least sure of ninety.
  test("is as sure as the share of its cells decided clearly", async () => {
    expect(await count([0.9, 0.9, 0.9, 0.5, 0.5, 0.5])).toEqual({ text: "6", p: 0.5 });
    expect(await count([0.9, 0.9, 0.35, 0.4])).toEqual({ text: "2", p: 0.5 });
  });

  test("no entry at all is not stated", async () => {
    expect(await count([0.05, 0.1])).toEqual({ text: "not stated", p: 1 });
    expect(await count([0.4, 0.3])).toEqual({ text: "not stated", p: 1 });
  });

  test("a page with nothing that could be a name is not stated without a call", async () => {
    const never = { systemOne: async () => { throw new Error("asked"); } } as unknown as Parameters<typeof answerFrom>[0];
    expect(await answerFrom(never, "count", "q", "s", "12 34\n56")).toEqual({ text: "not stated", p: 1 });
  });
});

describe("a statement", () => {
  const stub = (stated: number, contradicted: number, kind: number) =>
    ({
      systemOne: async () => ({ answers: { c0: { noul: stated }, c1: { noul: contradicted }, c2: { noul: kind } } }),
    }) as unknown as Parameters<typeof answerFrom>[0];
  const ask = (s: number, c: number, a = 0.1, text = "Cleaver\nDeadwalker\nVermissian Knight") =>
    answerFrom(stub(s, c, a), "truth", "Is knight a class?", "Classes", text);

  test("the verdict off the gate's nouls is the same verdict", () => {
    expect(claimVerdict("Is knight a class?", "Cleaver\nDeadwalker\nVermissian Knight", [0.1, 0.2, 0.9])).toEqual({ text: "false", p: 0.9 });
    expect(claimVerdict("Is witch a class?", "Cleaver\nWitch", [0.8, 0.1, 0.9])).toEqual({ text: "true", p: 0.8 });
  });

  test("stated is true", async () => {
    expect(await ask(0.9, 0.1)).toEqual({ text: "true", p: 0.9 });
  });

  test("contradicted is false, as sure as the contradiction", async () => {
    expect(await ask(0.1, 0.8)).toEqual({ text: "false", p: 0.8 });
  });

  test("missing from the list of its kind is false, as sure as the list", async () => {
    expect(await ask(0.1, 0.3, 0.85)).toEqual({ text: "false", p: 0.85 });
  });

  // The bug this guards: a page that never mentioned the claim, stated 0.02,
  // read false at 0.98 once its list noul crossed 0.5.
  test("a weak list without the name is a weak false, whatever the stated noul", async () => {
    expect(await ask(0.02, 0.2, 0.51)).toEqual({ text: "false", p: 0.51 });
  });

  // The bug this guards: a page that never mentions the claim answered false
  // at p=0.96, since "does not state" and "contradicts" were one criterion.
  test("none of them is silence, not a false", async () => {
    expect(await ask(0.1, 0.2, 0.3)).toEqual({ text: "not stated", p: 0.7 });
  });

  // The exact name is a string comparison: a list holding "Vermissian
  // Knight" does not name "knight", and one holding "Knight" does.
  test("a list of the kind that names the thing is no false", async () => {
    expect(await ask(0.4, 0.1, 0.9, "Cleaver\nKnight\nWitch")).toEqual({ text: "not stated", p: 0.6 });
    expect(await ask(0.4, 0.1, 0.9)).toEqual({ text: "false", p: 0.9 });
  });
});

describe("figureLimit", () => {
  test("offers every figure when the page is small", () => {
    expect(figureLimit(4000, 1, 60)).toBe(254);
  });

  test("shrinks as more quantities each repeat the list", () => {
    expect(figureLimit(4000, 5, 60)).toBeLessThan(figureLimit(4000, 1, 60));
  });

  test("never offers fewer than one", () => {
    expect(figureLimit(500_000, 9, 60)).toBe(1);
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

  test("a figure repeated on one line is one figure, with its first context", () => {
    const [f] = figuresIn("Weight: 1 pounds. Cost: 1 cap.");
    expect(figuresIn("Weight: 1 pounds. Cost: 1 cap.")).toHaveLength(1);
    expect(f!.context).toContain("Weight: 1 pounds");
  });

  // The bug this guards: "5" in the header row hid the "5" in the Combat
  // Rifle row, so the damage rating was a choice the model was never offered.
  test("a figure repeated on another line is another option, with that row", () => {
    const fs = figuresIn("Damage 5 max\nCombat Rifle 5C\nLaser 5C\nPistol 5C");
    expect(fs.map((f) => f.value)).toEqual(["5", "5", "5"]);
    expect(fs[1]!.context).toContain("Combat Rifle");
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
    expect(await answerFrom(stub("80", 0.9), "number", "How much does the Umber cost?", "s", text)).toEqual({ text: "80", p: 0.9 });
  });

  test("a page without figures is not stated, without asking", async () => {
    const never = { systemOne: async () => { throw new Error("asked"); } } as unknown as Parameters<typeof answerFrom>[0];
    expect(await answerFrom(never, "number", "q", "s", "no figures here")).toEqual({ text: "not stated", p: 1 });
  });

  test("a value on two rows is two options, and their probabilities add up for the value", async () => {
    const rows = "Damage 5 max\nCombat Rifle 5C\nCost 80";
    const pick = {
      systemOne: async ({ questions }: { questions: Record<string, { criteria: Record<string, string> }> }) => {
        const keys = Object.keys(Object.values(questions)[0]!.criteria);
        // Integer keys come first, in numeric order: that is JavaScript, not the text.
        expect(keys).toEqual(["5", "80", "5 #2", "not stated"]);
        // 80 leads any one option, but the two rows of 5 together lead it.
        return { answers: { q0: { type: "choice", choice: "80", confidence: 0.5, probabilities: { "5": 0.45, "5 #2": 0.4, "80": 0.5, "not stated": 0.05 } } } };
      },
    } as unknown as Parameters<typeof answerFrom>[0];
    const a = await answerFrom(pick, "number", "q", "s", rows);
    expect(a.text).toBe("5");
    expect(a.p).toBeCloseTo(0.85);
  });
});

describe("readQuestion", () => {
  /** Says yes to the listed quantity, kind and subject words, and calls every question the given kind. */
  const stub = (kind: string, quantities: string[], kinds: string[] = [], subject: string[] = [], game: string[] = []) =>
    ({
      systemOne: async ({ questions }: { questions: Record<string, { type: string; instructions: string }> }) => ({
        answers: Object.fromEntries(
          Object.entries(questions).map(([k, q]) => {
            if (q.type === "choice") return [k, { type: "choice", choice: kind, confidence: 1, probabilities: { [kind]: 1 } }];
            const word = /^`words\[\d+\]` \("(.*?)"\)/.exec(q.instructions)![1]!;
            const list = q.instructions.includes("kind of thing")
              ? kinds
              : q.instructions.includes("is about")
                ? subject
                : q.instructions.includes("asked of")
                  ? game
                  : quantities;
            const yes = list.includes(word);
            return [k, { type: "noul", noul: yes ? 0.9 : 0.1 }];
          }),
        ),
      }),
    }) as unknown as Parameters<typeof readQuestion>[0];
  const quantities = async (yes: string[], q: string) => (await readQuestion(stub("number", yes), q)).quantities;

  test("reads the kind and the quantities in one call", async () => {
    expect(await readQuestion(stub("number", ["cost"]), "How much does the Umber cost?")).toEqual({
      kind: "number",
      quantities: ["cost"],
      counted: "",
      subject: [],
      game: [],
    });
  });

  test("reads what a count counts, joined into one name", async () => {
    expect(await readQuestion(stub("count", [], ["theme", "kits"]), "How many theme kits are there?")).toEqual({
      kind: "count",
      quantities: [],
      counted: "theme kits",
      subject: [],
      game: [],
    });
  });

  test("reads the game the question is asked of, apart from its subject", async () => {
    const read = await readQuestion(stub("passage", [], [], ["perks"], ["fallout"]), "What are the available perks in fallout?");
    expect(read.subject).toEqual(["perks"]);
    expect(read.game).toEqual(["fallout"]);
  });

  test("reads the subject the question is about, split from its quantities", async () => {
    const q = "What is the cost and weight of a combat rifle?";
    const read = await readQuestion(stub("number", ["cost", "weight"], [], ["combat", "rifle"]), q);
    expect(read.subject).toEqual(["combat rifle"]);
  });

  test("joins adjacent words into one name and splits names at commas", async () => {
    const names = await quantities(["cost", "weight", "damage", "rating"], "What is the cost, weight and damage rating of a combat rifle?");
    expect(names).toEqual(["cost", "weight", "damage rating"]);
  });

  test("a question naming no quantity yields none", async () => {
    expect(await quantities([], "How does it work?")).toEqual([]);
  });

  test("grammar words never name a quantity, whatever the model says, and they end a name", async () => {
    const names = await quantities(["What", "cost", "weight", "of"], "What is the cost and weight of the Lantern?");
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
            const name = /is the (.*?) that/.exec(q.instructions)![1]!;
            const [choice, p] = picks[name]!;
            return [k, { type: "choice", choice, confidence: p, probabilities: { [choice]: p } }];
          }),
        ),
      }),
    }) as unknown as Parameters<typeof answerFrom>[0];
  const ask = (picks: Record<string, [string, number]>) =>
    answerFrom(stub(picks), "number", "q", "s", text, { quantities: Object.keys(picks) });

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
  /** Picks the group whose description names `word`; calls every group's entries groups of the things when `groups` is set. */
  const picker = (word: string, groups = false) =>
    ({
      systemOne: async ({ questions }: { questions: { group: { criteria: Record<string, string> } } }) => {
        const choice = Object.entries(questions.group.criteria).find(([, d]) => d.includes(`${word}" lists`))![0];
        const nouls = Object.fromEntries(Object.keys(questions).filter((k) => /^g\d+$/.test(k)).map((k) => [k, { type: "noul", noul: groups ? 0.9 : 0.1 }]));
        return { answers: { group: { type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } }, ...nouls } };
      },
    }) as unknown as TypeSafeClient;
  const at = (paths: string[]) => paths.map((path, i) => ({ path, start: i + 1, end: i + 1 }));

  test("counts a section's entries however many pages each takes", async () => {
    const paths = ["Callings", ...["Adventure", "Enlightenment", "Forced", "Heartsong", "Penitent"].map((c) => `Callings > ${c}`)];
    const r = await answerFromOutline(picker("Callings"), "count", "How many callings?", at(paths), 0.7);
    expect(r).toEqual({ answer: { text: "5", p: 0.9 }, parent: "Callings" });
  });

  // The bug this guards: Cyberpunk Red's skill list bookmarks its nine groups
  // of skills, "Awareness Skills" and so on, and the contents answered nine.
  test("reads the pages when the entries are groups of the things, not the things", async () => {
    const paths = ["Skill List", ...["Awareness", "Body", "Control"].map((g) => `Skill List > ${g} Skills`)];
    const r = await answerFromOutline(picker("Skill List", true), "count", "How many skills?", at(paths), 0.7, "skills");
    expect(r).toEqual({ parent: "Skill List" });
  });

  // The bug this guards: the Fallout rulebook nests 89 of its 94 perks under
  // the first perk, so the perks section lists one perk and six statistics.
  test("reads the pages when an entry holds more entries than its parent", async () => {
    const paths = ["Perks", "Perks > Aquaboy", "Perks > Carry Weight", "Perks > Defense"];
    for (let i = 0; i < 10; i++) paths.push(`Perks > Aquaboy > Perk ${i}`);
    const r = await answerFromOutline(picker("Perks"), "count", "How many perks?", at(paths), 0.7);
    expect(r).toEqual({ parent: "Perks" });
  });

  // The bug this guards: the rule below sent Heart's nine classes to the
  // pages because their parent has two children. Callings has children too,
  // so Classes is a list beside a list, not a swallowed entry.
  test("counts a list beside another list under a small parent", async () => {
    const paths = ["Characters", "Characters > Callings", "Characters > Classes"];
    for (const c of ["Adventure", "Enlightenment", "Forced", "Heartsong", "Penitent"]) paths.push(`Characters > Callings > ${c}`);
    for (let i = 0; i < 9; i++) paths.push(`Characters > Classes > Class ${i}`);
    const r = await answerFromOutline(picker("Classes"), "count", "How many classes?", at(paths), 0.7);
    expect(r).toEqual({ answer: { text: "9", p: 0.9 }, parent: "Characters > Classes" });
  });

  // The bug this guards: picking the swallowed entry itself answered 89 of
  // 94 perks at p=0.93, the entry's own list being the one that fit.
  test("reads the parent's pages when the picked entry is where the list went", async () => {
    const paths = ["Perks", "Perks > Aquaboy", "Perks > Carry Weight", "Perks > Defense"];
    for (let i = 0; i < 10; i++) paths.push(`Perks > Aquaboy > Perk ${i}`);
    const r = await answerFromOutline(picker("Aquaboy"), "count", "How many perks?", at(paths), 0.7, "perks");
    expect(r).toEqual({ parent: "Perks" });
  });

  // The bug this guards: a Classes list beside two childless sections sent
  // the whole Characters chapter to the pages, since the rule above looked
  // only at the siblings.
  test("keeps a list whose chapter is not about the kind counted", async () => {
    const paths = ["Characters", "Characters > Classes", "Characters > Ancestry", "Characters > Advancement"];
    for (let i = 0; i < 9; i++) paths.push(`Characters > Classes > Class ${i}`);
    const r = await answerFromOutline(picker("Classes"), "count", "How many classes?", at(paths), 0.7, "classes");
    expect(r).toEqual({ answer: { text: "9", p: 0.9 }, parent: "Characters > Classes" });
  });
});

describe("countAcross", () => {
  const sure = (n: number, p = 0.9) => Array.from({ length: n }, () => p);

  test("leaves out a part below the floor and keeps the confidence of the rest", async () => {
    const a = await countAcross(stubCells([[1, 0.9], [37, 0.55], [1, 0.8]]), "q", "s", ws(3), "", 0.7);
    expect(a.text).toBe("2");
    expect(a.p).toBeCloseTo(2 / 3);
  });

  // The bug this guards: three sure pages of a 36-page section summed to 3
  // classes at p=0.77, a confident undercount of nine.
  test("a count covering little of the section is not confident", async () => {
    const parts = [[1, 0.9], [1, 0.8], [1, 0.8], [10, 0.55], [8, 0.6], [3, 0.5]] as [number, number][];
    const a = await countAcross(stubCells(parts), "q", "s", ws(6), "", 0.7);
    expect(a.text).toBe("3");
    expect(a.p).toBeCloseTo(3 / 6);
  });

  test("every part below the floor is not stated", async () => {
    const a = await countAcross(stubCells([[10, 0.55], [30, 0.6]]), "q", "s", ws(2), "", 0.7);
    expect(a.text).toBe("not stated");
  });

  test("adds the parts up", async () => {
    const a = await countAcross(stubCells([[10, 0.9], [10, 0.95], [10, 0.8]]), "q", "s", ws(3));
    expect(a.text).toBe("30");
  });

  test("names the pages that counted anything", async () => {
    const a = await countAcross(stubCells([[0.05], sure(2), sure(7)]), "q", "s", ws(3));
    expect(a).toEqual({ text: "9", p: 1, pages: [2, 3] });
  });

  test("reports the least certain part that contributed", async () => {
    const a = await countAcross(stubCells([sure(4), [...sure(3), 0.5, 0.5, 0.5]]), "q", "s", ws(2));
    expect(a).toEqual({ text: "10", p: 0.5, pages: [1, 2] });
  });

  // A long list has windows holding none of it; that is expected, not doubt.
  test("a window listing none neither adds nor lowers confidence", async () => {
    const a = await countAcross(stubCells([sure(7), [0.05], [0.1]]), "q", "s", ws(3));
    expect(a).toEqual({ text: "7", p: 1, pages: [1] });
  });

  // The bug this guards: the Fallout skills page lists all seventeen skills
  // and the three pages after it headline each again; the sum was 34.
  test("counts a name listed in two windows once", async () => {
    const twice = [{ page: 1, text: "Athletics\nBarter\nProse here." }, { page: 2, text: "Athletics\nBig Guns\nProse here." }];
    const a = await countAcross(stubCells([sure(2), sure(2)]), "q", "s", twice);
    expect(a).toEqual({ text: "3", p: 1, pages: [1, 2] });
  });

  test("reports each part as it lands", async () => {
    const seen: number[] = [];
    await countAcross(stubCells([sure(2), sure(3)]), "q", "s", ws(2), "", 0, (_p, _a, _c, running) => seen.push(running));
    expect(seen).toEqual([2, 5]);
  });
});
