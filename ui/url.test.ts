import { describe, expect, test } from "bun:test";
import { hashFor, moves, runInHash } from "./url";

describe("the run in the address", () => {
  test("round-trips an id and reads nothing else", () => {
    const id = crypto.randomUUID();
    expect(runInHash(hashFor(id))).toBe(id);
    expect(hashFor(undefined)).toBe("");
    expect(runInHash("")).toBeUndefined();
    expect(runInHash("#other")).toBeUndefined();
    expect(runInHash("#run=../x")).toBeUndefined();
  });
});

describe("moves", () => {
  // `n` on the welcome page stacked a history entry per press.
  test("only a different address is a move", () => {
    expect(moves("/", "http://127.0.0.1:3217/")).toBe(false);
    expect(moves("#run=a", "http://127.0.0.1:3217/#run=a")).toBe(false);
    expect(moves("/", "http://127.0.0.1:3217/#run=a")).toBe(true);
    expect(moves("#run=b", "http://127.0.0.1:3217/#run=a")).toBe(true);
  });
});
