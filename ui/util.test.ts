import { describe, expect, test } from "bun:test";
import { bytes, modKey, plainTitle } from "./util";

describe("bytes", () => {
  test("says a file is empty only when it is, and rounds anything else up to a kilobyte at least", () => {
    expect(bytes(0)).toBe("empty");
    expect(bytes(1)).toBe("1 kB");
    expect(bytes(2540)).toBe("3 kB");
    expect(bytes(2_500_000)).toBe("2.5 MB");
    expect(bytes(3_000_000_000)).toBe("3.0 GB");
  });
});

describe("modKey", () => {
  test("is ⌘ on Apple's systems and Ctrl elsewhere", () => {
    expect(modKey("MacIntel")).toBe("⌘");
    expect(modKey("iPhone")).toBe("⌘");
    expect(modKey("Linux x86_64")).toBe("Ctrl");
    expect(modKey("Win32")).toBe("Ctrl");
    expect(modKey("")).toBe("Ctrl");
  });
});

describe("plainTitle", () => {
  test("drops the object replacement character and invisible controls an outline carries, keeping the words spaced", () => {
    expect(["\uFFFC Skill Or Trade", "Rules > \uFFFCSkills", "Skill\u00ADful\u200B", "\uFEFFTab\there\n", "Plain"].map(plainTitle)).toEqual(["Skill Or Trade", "Rules > Skills", "Skillful", "Tab here", "Plain"]);
  });
});
