import { describe, expect, test } from "bun:test";
import { num, parseFlags, readDefaults, readFlags, renderPassage } from "./cli";
import type { Para } from "./layout";

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
  test("pages are gated one by one unless --whole-windows", () => {
    expect(readDefaults().perPage).toBe(true);
    const o = readDefaults();
    parseFlags(["--whole-windows"], o, readFlags(), usage);
    expect(o.perPage).toBe(false);
  });

  test("-n and --hits set how many passages to collect", () => {
    const o = readDefaults();
    parseFlags(["-n", "3"], o, readFlags(), usage);
    expect(o.hits).toBe(3);
    expect(readDefaults().hits).toBe(1);
  });

  test("--kind takes only the three kinds", () => {
    const o = readDefaults();
    parseFlags(["--kind", "count"], o, readFlags(), usage);
    expect(o.kind).toBe("count");
    expect(() => parseFlags(["--kind", "maybe"], readDefaults(), readFlags(), usage)).toThrow("usage 1");
  });
});


describe("renderPassage", () => {
  const heads = ["Small Gun", "Damage", "Notes", "Cost"];
  const row = (cells: string[]): Para => ({ heading: false, text: JSON.stringify(cells), style: "", lines: [], table: { heads, cells } });
  const paras = [
    { heading: false, text: "Guns for sale.", style: "              ", lines: [] },
    row([".44 Pistol", "6", "", "99"]),
    row(["Combat Rifle", "5", "", "117"]),
    row(["Alt. Fire: None", "", "", ""]),
  ];
  const plain = (s: string) => s.replace(/\u001b\[[\d;]*m/g, "");

  test("a table's rows print as a grid under their heads, an empty column left out, a lone cell spanning", () => {
    expect(plain(renderPassage(paras, 80, true))).toBe(
      [
        "  Guns for sale.",
        "",
        "  Small Gun     Damage  Cost",
        "  .44 Pistol    6       99",
        "  Combat Rifle  5       117",
        "  Alt. Fire: None",
      ].join("\n"),
    );
  });

  test("too wide for the window, a row prints a head and its cell a line", () => {
    const wide = [row([".44 Pistol", "6", "Loud, heavy and hard to find in the wastes", "99"]), row(["Combat Rifle", "5", "", "117"])];
    expect(plain(renderPassage(wide, 40, true))).toBe(
      [
        "  Small Gun  .44 Pistol",
        "  Damage     6",
        "  Notes      Loud, heavy and hard to find in the wastes",
        "  Cost       99",
        "",
        "  Small Gun  Combat Rifle",
        "  Damage     5",
        "  Cost       117",
      ].join("\n"),
    );
  });

  test("a table takes the whole window, past the measure prose wraps at", () => {
    const wide = [row([".44 Pistol", "6", "x".repeat(100), "99"])];
    expect(plain(renderPassage(wide, 140, true)).split("\n")).toHaveLength(2);
  });

  test("piped, a row stays its one line of text", () => {
    expect(renderPassage(paras.slice(1, 2), 80, false)).toBe(`  ${paras[1]!.text}`);
  });
});
