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
});

describe("readFlags", () => {
  test("--kind takes only the three kinds", () => {
    const o = readDefaults();
    parseFlags(["--kind", "count"], o, readFlags(usage), usage);
    expect(o.kind).toBe("count");
    expect(() => parseFlags(["--kind", "maybe"], readDefaults(), readFlags(usage), usage)).toThrow("usage 1");
  });
});
