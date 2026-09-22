import { describe, expect, test } from "bun:test";
import { num, parseFlags, readDefaults, readFlags } from "./cli";

const usage = (code: number): never => {
  throw new Error(`usage ${code}`);
};

describe("parseFlags", () => {
  test("sets flags by either name and returns the positionals", () => {
    const o = { top: 0, json: false };
    const rest = parseFlags(["-n", "3", "what", "--json", "is", "it"], o, {
      "-n|--top": num("top"),
      "--json": (o) => (o.json = true),
    }, usage);
    expect(o).toEqual({ top: 3, json: true });
    expect(rest).toEqual(["what", "is", "it"]);
  });

  test("a flag missing its value reads as empty", () => {
    const o = { model: "x" };
    parseFlags(["--model"], o, { "--model": (o, next) => (o.model = next()) }, usage);
    expect(o.model).toBe("");
  });

  test("-h asks for usage", () => {
    expect(() => parseFlags(["-h"], {}, {}, usage)).toThrow("usage 0");
  });

  // Folding an unknown flag into the positionals asked a different question.
  test("an unknown flag is an error, not a positional", () => {
    expect(() => parseFlags(["ask", "--typo"], {}, {}, usage)).toThrow("usage 1");
  });

  test("a lone dash is a positional, since stdin is spelled that way", () => {
    expect(parseFlags(["-"], {}, {}, usage)).toEqual(["-"]);
  });

  test("a number flag rejects a value that is not one", () => {
    expect(() => parseFlags(["-n", "abc"], { top: 0 }, { "-n": num("top") }, usage)).toThrow("usage 1");
    const o = { top: 0 };
    parseFlags(["-n", "-3.5"], o, { "-n": num("top") }, usage);
    expect(o.top).toBe(-3.5);
  });
});

describe("readFlags", () => {
  test("--kind takes only the three kinds", () => {
    const o = readDefaults();
    parseFlags(["--kind", "count"], o, readFlags(), usage);
    expect(o.kind).toBe("count");
    expect(() => parseFlags(["--kind", "maybe"], readDefaults(), readFlags(), usage)).toThrow("usage 1");
  });
});

