import { describe, expect, test } from "bun:test";
import { KINDS as CLI_KINDS } from "../answer";
import { CACHE_MODELS } from "../cache";
import { parseFlags, readDefaults, readFlags } from "../cli";
import { findDefaults } from "../shelf";
import { argsFor, CACHE_BARS, CACHES, clampOption, commandFor, DEFAULTS, invalid, KINDS, SPECS, weakMatch, type Options } from "./options";

const usage = (code: number): never => {
  throw new Error(`usage ${code}`);
};

describe("the UI's options", () => {
  test("name the CLI's kinds and cache models, and the models' bars", () => {
    expect([...KINDS]).toEqual([...CLI_KINDS]);
    expect<string[]>([...CACHES]).toEqual([...Object.keys(CACHE_MODELS), "off"]);
    expect<unknown>(CACHE_BARS).toEqual(Object.fromEntries(Object.values(CACHE_MODELS).map((m) => [m.id, { whole: m.whole, subject: m.subject }])));
  });

  test("call a cached ranking's match weak only near or under its bar", () => {
    expect(weakMatch("qwen3-4b", 0.55)).toBe(true);
    expect(weakMatch("qwen3-4b", 0.4)).toBe(true);
    expect(weakMatch("qwen3-4b", 0.89)).toBe(false);
    expect(weakMatch("off", 0.1)).toBe(false);
  });

  test("every option has a spec", () => {
    expect(SPECS.map((s) => s.key).sort()).toEqual(Object.keys(DEFAULTS).sort() as (keyof Options)[]);
  });

  test("default to what the CLI defaults to", () => {
    const cli = findDefaults();
    for (const key of ["hits", "cache", "threshold", "answerFloor", "search", "max", "maxAnswers", "titleFloor", "fileFloor", "maxFiles", "chars", "batch"] as const)
      expect<unknown[]>([key, DEFAULTS[key]]).toEqual([key, cli[key]]);
    expect(DEFAULTS.toc).toBe(!readDefaults().noToc);
    expect(DEFAULTS.wholeWindows).toBe(!readDefaults().perPage);
  });

  test("pass no flags at their defaults", () => {
    expect(argsFor("jevsec", DEFAULTS)).toEqual([]);
    expect(argsFor("jevfind", DEFAULTS)).toEqual([]);
    expect(argsFor("jevgrep", DEFAULTS)).toEqual([]);
  });

  // Every flag the UI can send must be one the CLI takes, or the run stops on usage.
  test("send only flags the CLI parses, to the values chosen", () => {
    const every: Options = { ...DEFAULTS, kind: "count", hits: 3, cache: "off", across: "on", threshold: 0.5, answerFloor: 0.6, search: false, toc: false, wholeWindows: true, max: 20, maxAnswers: 7, titleFloor: 0.5, fileFloor: 1, maxFiles: 9, chars: 12000, batch: 20, model: "semif" };
    const o = { ...findDefaults(), across: undefined as boolean | undefined };
    const flags = { ...readFlags(), "--file-floor": (x: typeof o, next: () => string) => (x.fileFloor = Number(next())), "--max-files": (x: typeof o, next: () => string) => (x.maxFiles = Number(next())), "--across": (x: typeof o) => (x.across = true), "--no-across": (x: typeof o) => (x.across = false) };
    expect(parseFlags(argsFor("jevfind", every), o, flags, usage)).toEqual([]);
    expect(o).toMatchObject({ kind: "count", hits: 3, cache: "off", across: true, threshold: 0.5, answerFloor: 0.6, search: false, noToc: true, perPage: false, max: 20, maxAnswers: 7, titleFloor: 0.5, fileFloor: 1, maxFiles: 9, chars: 12000, batch: 20, model: "semif" });
  });

  test("keep jevgrep's own -n and -t apart from the readers'", () => {
    const o = { ...DEFAULTS, top: 5, nameFloor: 2, hits: 3, threshold: 0.5 };
    expect(argsFor("jevgrep", o)).toEqual(["-n", "5", "-t", "2"]);
    expect(argsFor("jevsec", o)).toEqual(["-n", "3", "-t", "0.5"]);
  });

  test("every spec's key is an option", () => {
    for (const s of SPECS) expect(Object.keys(DEFAULTS)).toContain(s.key);
  });
});

describe("invalid", () => {
  test("names the first number out of its range for the tool", () => {
    expect(invalid("jevsec", DEFAULTS)).toBeUndefined();
    expect(invalid("jevsec", { ...DEFAULTS, threshold: 5 })).toBe("Page threshold must be between 0 and 1");
    // jevgrep has no page threshold, so it does not stop on one.
    expect(invalid("jevgrep", { ...DEFAULTS, threshold: 5 })).toBeUndefined();
  });

  test("takes only whole numbers where the option counts something", () => {
    expect(invalid("jevsec", { ...DEFAULTS, hits: 1.5 })).toBe("Passages must be a whole number");
    expect(invalid("jevfind", { ...DEFAULTS, maxFiles: 2.5 })).toBe("Max files must be a whole number");
    expect(invalid("jevsec", { ...DEFAULTS, threshold: 0.55 })).toBeUndefined();
  });
});

describe("clampOption", () => {
  test("holds a number within its option's range", () => {
    const max = SPECS.find((s) => s.key === "max");
    if (max?.type !== "number") throw new Error("max is a number option");
    expect(clampOption("max", max.max * 2)).toBe(max.max);
    expect(clampOption("max", 24)).toBe(24);
    expect(clampOption("hits", 0)).toBe(1);
  });
});

describe("commandFor", () => {
  test("quotes what the shell would split", () => {
    expect(commandFor("jevsec", { ...DEFAULTS, hits: 2 }, "How do I start?", { pdf: "/books/My Book.pdf" })).toBe("bun jevsec.ts -n 2 '/books/My Book.pdf' 'How do I start?'");
  });

  test("feeds the shelf's folders to a shelf tool", () => {
    expect(commandFor("jevfind", DEFAULTS, "what's in it", { sources: ["/a", "/b c"] })).toBe(`find /a '/b c' -iname '*.pdf' | bun jevfind.ts 'what'\\''s in it'`);
  });

  test("feeds a locate command as it runs, and folders and commands together", () => {
    expect(commandFor("jevgrep", DEFAULTS, "q", { sources: ["plocate -i *.pdf"] })).toBe("plocate -i '*.pdf' | bun jevgrep.ts q");
    expect(commandFor("jevfind", DEFAULTS, "q", { sources: ["/a", "locate x.pdf"] })).toBe("{ find /a -iname '*.pdf'; locate x.pdf; } | sort -u | bun jevfind.ts q");
  });
});
