import { beforeAll, describe, expect, test } from "bun:test";
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { answerLayer, readDefaults, type ReadOpts } from "./cli";
import { makeUi, searchPdf, type Outcome } from "./pdf";
import { DEFAULT_MODEL, makeClient } from "./shared";

/**
 * The shelf: every case worked through by hand on real rulebooks, kept as a
 * test so a change to a prompt or the walk cannot quietly undo one. The
 * books are not redistributable, so each is named by an environment
 * variable and its cases skip when it is unset or absent. Like the other
 * live tests these spend tokens and assert direction, never an exact
 * probability, and a walk over a 400-page book outlasts bun's five-second
 * default, so: bun run test:books
 */
const live = process.env.JEV_LIVE === "1";
const book = (env: string) => {
  const path = process.env[env] ?? "";
  return { path, present: live && path !== "" };
};
const heart = book("JEV_HEART_PDF");
const fallout = book("JEV_FALLOUT_PDF");
const litm = book("JEV_LITM_PDF");
const cpr = book("JEV_CPR_PDF");
for (const b of [heart, fallout, litm, cpr]) if (b.present && !(await Bun.file(b.path).exists())) b.present = false;

let client: TypeSafeClient;
const ui = makeUi(true);
beforeAll(async () => {
  if (live) client = await makeClient(DEFAULT_MODEL);
});

/** Runs a question through the same layers the CLI does, returning the outcome. */
async function ask(pdf: string, question: string, extra: Partial<ReadOpts> = {}): Promise<Outcome> {
  const search = await answerLayer(client, { ...readDefaults(), question, quiet: true, ...extra }, ui);
  return searchPdf(client, pdf, search, ui);
}
const answer = (r: Outcome) => r.hit?.answer?.text ?? r.rejected.reduce<string | undefined>((best, c) => best ?? c.answer.text, undefined);
const count = (r: Outcome) => Number(answer(r));

describe.if(heart.present)("Heart: The City Beneath", () => {
  test("counts the classes and callings from the contents", async () => {
    expect(count(await ask(heart.path, "How many classes are there in heart?"))).toBe(9);
    expect(count(await ask(heart.path, "How many callings are there in heart?"))).toBe(5);
  });

  test("counts the skills and domains off the page, linking to the page that lists them", async () => {
    const skills = await ask(heart.path, "how many skills are there in heart?");
    expect(count(skills)).toBe(9);
    expect(skills.hit?.page).toBe(12);
    const domains = await ask(heart.path, "how many domains are there in heart?");
    expect(count(domains)).toBe(8);
    expect(domains.hit?.page).toBe(12);
  });

  test("settles membership: a listed entry is true, a fragment or a stranger is false", async () => {
    expect(answer(await ask(heart.path, "Is witch a class in heart?"))).toBe("true");
    expect(answer(await ask(heart.path, "Is knight a class in heart?"))).toBe("false");
    expect(answer(await ask(heart.path, "Is witch hunter a class in heart?"))).toBe("false");
    expect(answer(await ask(heart.path, "Is heretic a calling in heart?"))).toBe("false");
  });

  test("reads the skills list as a passage, in column order, without the domains", async () => {
    const r = await ask(heart.path, "What are the skills available to a character?");
    expect(r.hit?.page).toBe(12);
    const text = answer(r)!;
    for (const skill of ["COMPEL", "DELVE", "DISCERN", "ENDURE", "EVADE", "HUNT", "KILL", "MEND", "SNEAK"]) expect(text).toContain(skill);
    expect(text).not.toContain("CURSED");
    expect(text.indexOf("DISCERN")).toBeLessThan(text.indexOf("ENDURE"));
  });

  test("reads the three-column tags page column by column, without the running header", async () => {
    const r = await ask(heart.path, "what are the equipment tags");
    expect(r.hit?.page).toBe(102);
    const text = answer(r)!;
    expect(text.indexOf("BLOCK:")).toBeLessThan(text.indexOf("BLOODBOUND:"));
    expect(text.indexOf("BLOODBOUND:")).toBeLessThan(text.indexOf("EXPENSIVE:"));
    expect(text.indexOf("EXPENSIVE:")).toBeLessThan(text.indexOf("RANGED:"));
    expect(text).not.toContain("Resources & Equipment");
  });
});

describe.if(fallout.present)("Fallout: The Roleplaying Game", () => {
  test("counts the perks off their pages, not the swallowed outline entry", async () => {
    const r = await ask(fallout.path, "How many perks are there?");
    expect(count(r)).toBeGreaterThanOrEqual(93);
    expect(count(r)).toBeLessThanOrEqual(96);
    expect(r.hit?.answer?.p).toBeGreaterThanOrEqual(0.7);
    expect(r.hit?.page).toBe(61);
  });

  test("counts the skills once across the summary page and the pages after it", async () => {
    expect(count(await ask(fallout.path, "How many skills are there?"))).toBe(17);
  });

  test("settles membership across kinds", async () => {
    expect(answer(await ask(fallout.path, "Is Gunslinger a perk?"))).toBe("true");
    expect(answer(await ask(fallout.path, "Is Lockpick a perk?"))).toBe("false");
  });

  test("reads the RadAway entry as a passage from a two-column page", async () => {
    const r = await ask(fallout.path, "How is radiation treated?");
    expect(r.hit?.page).toBe(171);
    expect(answer(r)).toContain("RadAway");
  });

  test("reads a combat rifle's figures off the small guns table, once the walk reaches it", async () => {
    const r = await ask(fallout.path, "What is the cost, weight and damage rating of a combat rifle?", { max: 20 });
    expect(r.hit?.page).toBe(97);
    expect(answer(r)).toMatch(/cost \d+, weight \d+, damage rating \d/);
  });
});

describe.if(litm.present)("Legend in the Mist", () => {
  test("counts the theme types off their page", async () => {
    const r = await ask(litm.path, "How many theme types are there?");
    expect(count(r)).toBeGreaterThanOrEqual(19);
    expect(count(r)).toBeLessThanOrEqual(20);
    expect(r.hit?.page).toBe(75);
  });

  test("reads hero creation as a passage with its headings", async () => {
    const r = await ask(litm.path, "How does hero creation work in Legend in the Mist?");
    expect(r.hit?.page).toBe(73);
    const text = answer(r)!;
    expect(text).toContain("The Simplest Way");
    expect(text).toContain("The Quickest Way");
    expect(text).toContain("The Detailed Way");
  });
});

describe.if(cpr.present)("Cyberpunk Red", () => {
  test("counts the skills off their pages, not the nine groups the contents list", async () => {
    const r = await ask(cpr.path, "How many skills are there in the game?");
    expect(count(r)).toBeGreaterThanOrEqual(64);
    expect(count(r)).toBeLessThanOrEqual(66);
  });
});

test.if(!live)("the shelf tests are skipped without JEV_LIVE=1", () => {
  expect(live).toBe(false);
});
