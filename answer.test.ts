import { beforeAll, describe, expect, test } from "bun:test";
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { answerFrom, countAcross, readPassage, readQuestion, type Kind } from "./answer";
import { columns, pageScan, searchPdf } from "./pdf";
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

describe.if(live)("readQuestion", () => {
  test.each([
    ["How many skills does a vault dweller have?", "count"],
    ["How many themes does a hero have?", "count"],
    ["How much does the Umber cost?", "number"],
    ["How many rads are lethal without treatment?", "number"],
    ["What is the carry weight of a vault dweller?", "number"],
    ["What is the cost, weight and damage rating of a combat rifle?", "number"],
    ["Is Gunslinger a perk?", "truth"],
    ["Radiation damage is permanent until treated.", "truth"],
    ["How do I treat radiation sickness?", "passage"],
    ["What does the Lockpick skill cover?", "passage"],
  ] as [string, Kind][])("%s is a %s question", async (question, kind) => {
    expect((await readQuestion(client, question)).kind).toBe(kind);
  });
});

describe.if(live)("truth", () => {
  const ask = (q: string) => answerFrom(client, "truth", q, "Classes", heartText);

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
  test("counts a list the text spells out inline", async () => {
    const a = await answerFrom(client, "count", "How many skills does a vault dweller have?", "Skills", manualText);
    expect(a.text).toBe("7");
  });

  test("counts a list the text gives one per line", async () => {
    const a = await answerFrom(client, "count", "How many classes are there in heart?", "Classes", heartText);
    expect(a.text).toBe("9");
  });

  test("a page listing none of them is not stated", async () => {
    const a = await answerFrom(client, "count", "How many perks are there?", "Radiation", manualText);
    expect(a.text).toBe("not stated");
  });
});

describe.if(live)("passage", () => {
  test("reads the sentences that answer off the page", async () => {
    const text = columns(await Bun.$`pdftotext -layout -f 3 -l 3 ${fixture("manual.pdf")} -`.text());
    const a = await readPassage(client, "How is radiation treated?", "Chapter III: Radiation", text);
    expect(a.text).toContain("RadAway");
    expect(a.text).not.toContain("dosimeter");
    expect(a.p).toBeGreaterThan(0.7);
  });
});

describe.if(live)("per-page gating", () => {
  const opts = { question: "", threshold: 0.7, titleFloor: 1, max: 12, chars: 48000, batch: 40, perPage: true };
  const ui = { log: () => {}, trying: () => {}, clear: () => {} };

  // 24 pages of near-identical entries; only one names the Fen Gasket.
  test("lands on the one page of a long section that answers", async () => {
    const question = "How much does the Fen Gasket cost?";
    const { hit, tried } = await searchPdf(client, fixture("catalogue.pdf"), { ...opts, question }, ui);
    expect(hit?.page).toBe(24);
    expect(tried).toHaveLength(24);
    const others = tried.filter((t) => t.page !== 24).map((t) => t.p);
    expect(Math.max(...others)).toBeLessThan(0.5);
  });
});

describe.if(live)("counting across windows", () => {
  test("sums a list too long for one window", async () => {
    // 30 gadgets, ten per page, forced into one window per page.
    const windows = await pageScan(fixture("gadgets.pdf"), 900);
    expect(windows.length).toBeGreaterThan(1);
    const a = await countAcross(client, "How many gadgets are there?", "Gadgets", windows);
    expect(a.text).toBe("30");
  });
});

describe.if(live)("number", () => {
  test("reads a cost off the page that states it", async () => {
    const page = (await pageScan(fixture("gadgets.pdf"), 0))[2]!.text;
    const a = await answerFrom(client, "number", "How much does the Umber cost?", "Gadgets", page);
    expect(a.text).toBe("80");
  });

  test("reads a figure written in words", async () => {
    const a = await answerFrom(client, "number", "How many rads are lethal without treatment?", "Radiation", manualText);
    expect(a.text).toBe("200");
  });

  test("names the quantities a question asks for", async () => {
    const quantities = async (q: string) => (await readQuestion(client, q)).quantities;
    expect(await quantities("What is the cost, weight and damage rating of a combat rifle?")).toEqual(["cost", "weight", "damage rating"]);
    expect(await quantities("How much does the Umber cost?")).toEqual(["cost"]);
  });

  test("names the kind of thing a count counts", async () => {
    const counted = async (q: string) => (await readQuestion(client, q)).counted;
    expect(await counted("How many theme kits are there?")).toBe("theme kits");
    expect(await counted("How many skills does a vault dweller have?")).toBe("skills");
    expect(await counted("How many perks can a character take?")).toBe("perks");
  });

  test("reads several figures off one page", async () => {
    const page = (await pageScan(fixture("gadgets.pdf"), 0))[1]!.text;
    const a = await answerFrom(client, "number", "What is the cost and weight of the Lantern?", "Gadgets", page, { quantities: ["cost", "weight"] });
    expect(a.text).toBe("cost 53, weight 4");
  });

  test("declines when the page has the subject but not the figure", async () => {
    const a = await answerFrom(client, "number", "How much does a dosimeter weigh?", "Radiation", manualText);
    expect(a.text).toBe("not stated");
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
