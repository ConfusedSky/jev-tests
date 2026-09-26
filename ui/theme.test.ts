import { describe, expect, test } from "bun:test";
import { isDark } from "./theme";

describe("theme", () => {
  test("follows the system only when asked to", () => {
    expect(isDark("system", true)).toBe(true);
    expect(isDark("system", false)).toBe(false);
    expect(isDark("light", true)).toBe(false);
    expect(isDark("dark", false)).toBe(true);
  });
});
