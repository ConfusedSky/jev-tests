import { expect, test } from "bun:test";
import { msOf } from "./motion";

test("reads a CSS time as milliseconds, in either unit, as the build shortens it and with spaces around, and nothing for what is no time", () => {
  expect(["220ms", "0.22s", ".22s", " 220ms ", "", "none"].map(msOf)).toEqual([220, 220, 220, 220, 0, 0]);
});
