import { beforeAll, describe, expect, test } from "bun:test";
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { answerFrom, classify, countAcross, type Kind } from "./answer";
import { pageScan, searchPdf } from "./pdf";
import { DEFAULT_MODEL, makeClient } from "./shared";

// These spend money and jev is not deterministic, so they only assert the
// direction of an answer, never an exact probability. Run with JEV_LIVE=1.
const live = process.env.JEV_LIVE === "1";
const fixture = (name: string) => Bun.fileURLToPath(new URL(`fixture/${name}`, import.meta.url));

let client: TypeSafeClient;
let heartText: string;
let manualText: string;

beforeAll(async () => {
  if (!live) return;
  client = await makeClient(DEFAULT_MODEL);
  heartText = (await pageScan(fixture("heart.pdf"), 48000))[0]!.text;
  manualText = (await pageScan(fixture("manual.pdf"), 48000))[0]!.text;
});

describe.if(live)("classify", () => {
  test.each([
    ["How many skills does a vault dweller have?", "count"],
    ["How many themes does a hero have?", "count"],
    ["Is Gunslinger a perk?", "truth"],
    ["Radiation damage is permanent until treated.", "truth"],
    ["How do I treat radiation sickness?", "passage"],
    ["What does the Lockpick skill cover?", "passage"],
  ] as [string, Kind][])("%s is a %s question", async (question, kind) => {
    expect(await classify(client, question)).toBe(kind);
  });
});

describe.if(live)("truth", () => {
  const ask = (q: string) => answerFrom(client, "truth", q, "Classes", heartText, 50);

  test("a class the text names is true", async () => {
    expect((await ask("Is vermissian knight a class in heart?"))!.text).toBe("true");
    expect((await ask("Is deep apiarist a class in heart?"))!.text).toBe("true");
  });

  // The bug this guards: "knight" only appears inside "Vermissian Knight".
  test.each(["knight", "apiarist", "mage", "walker"])(
    "'%s' alone is not a class, only part of one",
    async (term) => {
      expect((await ask(`Is ${term} a class in heart?`))!.text).toBe("false");
    },
  );

  test("a claim the text contradicts is false", async () => {
    expect((await ask("Heart characters choose two classes each."))!.text).toBe("false");
  });
});

describe.if(live)("count", () => {
  test("counts a list the text spells out", async () => {
    const a = await answerFrom(client, "count", "How many skills does a vault dweller have?", "Skills", manualText, 50);
    expect(a!.text).toBe("7");
  });

  test("reports numbers stated in prose", async () => {
    const a = await answerFrom(client, "count", "How many rads are lethal without treatment?", "Radiation", manualText, 250);
    expect(a!.text).toBe("200");
  });

  // A Choice takes at most 255 options, so a larger ceiling is clamped rather
  // than sent and rejected with "Too many choices".
  test("a ceiling above the option limit still answers", async () => {
    const a = await answerFrom(client, "count", "How many skills does a vault dweller have?", "Skills", manualText, 9999);
    expect(a!.text).toBe("7");
  });

  test("a count above the ceiling is asked again with the full range", async () => {
    const a = await answerFrom(client, "count", "How many rads are lethal without treatment?", "Radiation", manualText, 5);
    expect(a.text).toBe("200");
  });
});

describe.if(live)("counting across windows", () => {
  test("sums a list too long for one window", async () => {
    // 30 gadgets, ten per page, forced into one window per page.
    const windows = await pageScan(fixture("gadgets.pdf"), 900);
    expect(windows.length).toBeGreaterThan(1);
    const a = await countAcross(client, "How many gadgets are there?", "Gadgets", windows, 60);
    expect(a.text).toBe("30");
  });
});

describe.if(live)("searchPdf", () => {
  const opts = { question: "", threshold: 0.7, titleFloor: 1, max: 12, chars: 48000, batch: 40 };
  const ui = { log: () => {}, trying: () => {}, clear: () => {} };

  test("lands on the section that holds the answer", async () => {
    const { hit } = await searchPdf(client, fixture("manual.pdf"), { ...opts, question: "How is radiation treated?" }, ui);
    expect(hit?.section).toBe("Chapter III: Radiation");
    expect(hit?.page).toBe(3);
  });

  test("falls back to a page scan when there is no outline", async () => {
    const { hit } = await searchPdf(client, fixture("heart.pdf"), { ...opts, question: "What classes can a character take?" }, ui);
    expect(hit?.section).toBe("p.1+");
    expect(hit?.text).toContain("Vermissian Knight");
  });

  test("reports no hit rather than a bad one", async () => {
    const { hit, tried } = await searchPdf(client, fixture("manual.pdf"), { ...opts, question: "What is the capital of Peru?", titleFloor: 0, max: 3 }, ui);
    expect(hit).toBeUndefined();
    expect(tried.length).toBeGreaterThan(0);
  });
});

test.if(!live)("live tests are skipped without JEV_LIVE=1", () => {
  expect(live).toBe(false);
});
