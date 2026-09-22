import { describe, expect, test } from "bun:test";
import { childrenByParent } from "./answer";
import { outline } from "./pdf";

/**
 * The Fallout core rulebook is not redistributable, so point JEV_FALLOUT_PDF at
 * a copy to run these; they skip otherwise. It is worth a test because its
 * outline is malformed in ways no generated fixture would be: the first perk
 * became the parent of the other 89, and six derived statistics are parked
 * under the perks section.
 */
const FALLOUT = process.env.JEV_FALLOUT_PDF ?? "";
const mounted = FALLOUT !== "" && (await Bun.file(FALLOUT).exists());
if (!mounted) console.warn("media tests skipped: set JEV_FALLOUT_PDF to the Fallout core rulebook");

describe.if(mounted)("a malformed outline", async () => {
  const sections = mounted ? await outline(FALLOUT) : [];
  const kids = childrenByParent(sections.map((s) => s.path));
  const perks = "Character Creation > Step 4: Choose Your First Perk";

  test("nests the rest of a list under its first entry", () => {
    expect(kids.get(`${perks} > Aquaboy/Aquagirl`)).toHaveLength(89);
  });

  test("so counting the section's own entries is wrong", () => {
    // 94 perks, but the section lists one perk and six derived statistics.
    expect(kids.get(perks)).toEqual([
      "Aquaboy/Aquagirl",
      "Carry Weight",
      "Damage Resistance",
      "Defense",
      "Initiative",
      "Health Points",
      "Melee Damage",
    ]);
  });

  test("spans far more pages than a list would, which is the signal to read instead", () => {
    const at = sections.find((s) => s.path === `${perks} > Aquaboy/Aquagirl`)!;
    expect(at.end - at.start + 1).toBeGreaterThan(3);
  });

  test("puts entries of the next section under the previous one", () => {
    const stats = sections.find((s) => s.path === `${perks} > Carry Weight`)!;
    const step5 = sections.find((s) => s.path === "Character Creation > Step 5: Derived Statistics")!;
    expect(stats.start).toBeGreaterThanOrEqual(step5.start);
  });
});
