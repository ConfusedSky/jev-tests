import { describe, expect, test } from "bun:test";
import { childrenByParent, membershipFromContents, mentions } from "./answer";

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
