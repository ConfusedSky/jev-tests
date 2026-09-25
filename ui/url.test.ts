import { describe, expect, test } from "bun:test";
import { hashFor, runInHash } from "./url";

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
