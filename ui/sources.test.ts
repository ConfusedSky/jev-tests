import { describe, expect, test } from "bun:test";
import { feed, isLocate, locateArgs, locateHint, shellWords, sourceKey } from "./sources";

describe("shellWords", () => {
  test("splits as a shell would, quotes and escapes included", () => {
    expect(shellWords(`plocate -i '*.pdf'`)).toEqual(["plocate", "-i", "*.pdf"]);
    expect(shellWords(`locate "Files and S/*.pdf" a\\ b it"'"s ""`)).toEqual(["locate", "Files and S/*.pdf", "a b", "it's", ""]);
    expect(shellWords(`plocate "say \\"hi\\""`)).toEqual(["plocate", 'say "hi"']);
  });

  // Run without a shell, these would reach plocate as literal words and do something else than they say.
  test("refuses what only a shell could do", () => {
    for (const line of ["plocate x | grep pdf", "plocate x; rm -rf ~", "plocate $(echo x)", "plocate `x`", `plocate "$HOME"`, "plocate x > out", "plocate x &"])
      expect(shellWords(line)).toHaveProperty("error");
  });

  test("refuses an unclosed quote", () => {
    expect(shellWords("plocate 'x")).toEqual({ error: "a ' is not closed" });
  });
});

describe("locateArgs", () => {
  test("takes only a locator with a pattern", () => {
    expect(locateArgs("  plocate -i heart  ")).toEqual({ argv: ["plocate", "-i", "heart"] });
    expect(locateArgs("find / -name x")).toHaveProperty("error");
    expect(locateArgs("plocate")).toHaveProperty("error");
  });
});

describe("locateHint", () => {
  test("points out a wildcard pattern that cannot match a whole path", () => {
    expect(locateHint(`plocate -i "fixture/*.pdf"`)).toBe("a pattern with a wildcard must match the whole path, so try '*fixture/*.pdf'");
    expect(locateHint("plocate -i '*fixture/*.pdf'")).toBeUndefined();
    expect(locateHint("plocate heart")).toBeUndefined();
  });
});

describe("sources", () => {
  test("tell a locate command from a folder by its first word", () => {
    expect(isLocate("plocate '*.pdf'")).toBe(true);
    expect(isLocate("/home/me/plocate")).toBe(false);
  });

  test("key a command by its words re-quoted, so what is shown is what runs", () => {
    expect(sourceKey(`plocate   -i "*.pdf"`)).toBe("plocate -i '*.pdf'");
    expect(sourceKey("/books")).toBe("/books");
  });

  test("feed one source bare and several grouped", () => {
    expect(feed(["/a"])).toBe("find /a -iname '*.pdf'");
    expect(feed(["plocate x"])).toBe("plocate x");
    expect(feed(["/a", "/b", "plocate x"])).toBe("{ find /a /b -iname '*.pdf'; plocate x; } | sort -u");
  });
});
