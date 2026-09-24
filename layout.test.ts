import { describe, expect, test } from "bun:test";
import { pageParagraphs, pageTables, paragraphs, parseStext, styledCandidates, type Table } from "./layout";

const fixture = (name: string) => Bun.fileURLToPath(new URL(`fixture/${name}`, import.meta.url));

/** One stext line: characters laid out `advance` apart, an extra `gap` before any character after a "|". */
function stextLine(x: number, y: number, size: number, font: string, text: string, advance = size * 0.5): string {
  let at = x;
  const chars = [...text]
    .map((c) => {
      if (c === "|") {
        at += size * 0.15;
        return "";
      }
      const q = `${at} ${y} ${at + advance} ${y} ${at} ${y + size} ${at + advance} ${y + size}`;
      at += advance;
      return `<char c="${c === "&" ? "&amp;" : c}" quad="${q}" x="${at}" y="${y + size}"/>`;
    })
    .join("");
  return `<line bbox="${x} ${y} ${at} ${y + size}"><font name="${font}" size="${size}">${chars}</font></line>`;
}
const page = (lines: string[], width = 612, height = 792) => `<page id="p" width="${width}" height="${height}"><block>${lines.join("")}</block></page>`;

describe("parseStext", () => {
  test("reads a line's box, size, text and weight", () => {
    const { lines } = parseStext(page([stextLine(50, 100, 12, "Alegreya-Bold", "COMPEL:")]));
    expect(lines).toEqual([{ x0: 50, y0: 100, x1: 92, y1: 112, size: 12, spans: [{ text: "COMPEL:", bold: true, italic: false, font: "Alegreya-Bold" }], block: 1 }]);
  });

  // The bug this guards: mutool glued half of every line on Heart's pages,
  // "theactionassociatedwiththeskill", though the gaps were in the boxes.
  test("puts a space back where two words sit apart with none between", () => {
    const { lines } = parseStext(page([stextLine(50, 100, 12, "Alegreya-Regular", "the|action|associated")]));
    expect(lines[0]!.spans[0]!.text).toBe("the action associated");
  });

  test("a line's size is that of most of its characters, not a superscript's", () => {
    const xml = page([
      `<line bbox="80 183 240 195"><font name="Book" size="9">${[..."suffer +1 "].map((c, i) => `<char c="${c}" quad="${80 + i * 4} 183 ${84 + i * 4} 183 ${80 + i * 4} 192 ${84 + i * 4} 192"/>`).join("")}</font><font name="FalloutBoy" size="12.8"><char c="D" quad="120 183 128 183 120 195 128 195"/></font></line>`,
    ]);
    expect(parseStext(xml).lines[0]!.size).toBe(9);
  });

  test("a private-use glyph is a bullet", () => {
    const { lines } = parseStext(page([stextLine(50, 100, 12, "Wingdings", "\uF0A7")]));
    expect(lines[0]!.spans[0]!.text).toBe("•");
  });
});

describe("paragraphs", () => {
  const body = (x: number, y: number, text: string, font = "Alegreya-Regular") => stextLine(x, y, 12, font, text);
  const skills = [
    body(50, 103, "COMPEL: Make people do what you", "Alegreya-Bold"),
    body(64, 117, "want via threats or lies."),
    body(50, 145, "DELVE: Progress into unknown"),
    body(64, 160, "territory."),
    body(50, 187, "ENDURE: Resist the effects of the Heart on your"),
    body(64, 201, "body and mind."),
    body(306, 103, "CURSED: Actively harmful"),
    body(320, 117, "locations."),
    body(306, 145, "DESOLATE: Wastelands and"),
    body(320, 160, "abandoned towns."),
  ];

  // The bug this guards: read line by line, Heart's skills and domains
  // interleave; read at the gutter, a long skill line was taken for a heading.
  test("reads each column down in turn, an entry and its wrapped lines as one paragraph", () => {
    expect(paragraphs(parseStext(page(skills))).map((p) => p.text)).toEqual([
      "COMPEL: Make people do what you want via threats or lies.",
      "DELVE: Progress into unknown territory.",
      "ENDURE: Resist the effects of the Heart on your body and mind.",
      "CURSED: Actively harmful locations.",
      "DESOLATE: Wastelands and abandoned towns.",
    ]);
  });

  test("keeps the weight of every character", () => {
    const [compel] = paragraphs(parseStext(page(skills)));
    expect(compel!.style.slice(0, 33)).toBe("b".repeat(31) + "  ");
    expect(compel!.style.length).toBe(compel!.text.length);
  });

  test("keeps each line's box and which characters it holds", () => {
    const [compel] = paragraphs(parseStext(page(skills)));
    expect(compel!.lines.map((l) => [l.y0, compel!.text.slice(l.start, l.end)])).toEqual([
      [103, "COMPEL: Make people do what you"],
      [117, "want via threats or lies."],
    ]);
  });

  test("a line in display type is a heading; the running header and page number in the margins are dropped", () => {
    const lines = [
      stextLine(50, 39, 24, "Bartender-SemiCondensed", "TAGS"),
      stextLine(578, 71, 18, "Bartender-SemiCondensed", "Resources & Equipment"),
      ...skills,
      stextLine(583, 742, 12, "Alegreya-Regular", "97"),
    ];
    const paras = paragraphs(parseStext(page(lines)));
    expect(paras[0]).toMatchObject({ heading: true, text: "TAGS" });
    expect(paras.map((p) => p.text)).not.toContain("Resources & Equipment");
    expect(paras.map((p) => p.text)).not.toContain("97");
  });

  // The bug this guards: wrapped bullet lines hanging two ems in became a
  // column of their own and were read after the whole list.
  test("a hanging indent is not a column", () => {
    const lines = [
      body(51, 100, "Some prose before the list runs here."),
      body(51, 116, "• First item that wraps onto the next"),
      body(71, 130, "first continues."),
      body(51, 146, "• Second item that wraps onto the next"),
      body(71, 160, "second continues."),
      body(51, 176, "• Third item that wraps onto the next"),
      body(71, 190, "third continues."),
      body(51, 210, "After the list the prose goes on here."),
    ];
    expect(paragraphs(parseStext(page(lines))).map((p) => p.text)).toEqual([
      "Some prose before the list runs here.",
      "• First item that wraps onto the next first continues.",
      "• Second item that wraps onto the next second continues.",
      "• Third item that wraps onto the next third continues.",
      "After the list the prose goes on here.",
    ]);
  });

  test("the last line of a column with a narrow bottom margin is body text, not a footer", () => {
    const lines = [...skills, body(50, 730, "The last line of the page at 730.")];
    expect(paragraphs(parseStext(page(lines))).map((p) => p.text)).toContain("The last line of the page at 730.");
  });

  test("a bullet starts a paragraph and a word broken at the margin is mended", () => {
    const lines = [
      body(51, 208, "• Think of their four themes."),
      body(51, 223, "• Add two more power tags to each"),
      body(60, 236, "theme."),
      body(51, 252, "• Write a Quest for each atten-"),
      body(60, 266, "tion."),
    ];
    expect(paragraphs(parseStext(page(lines))).map((p) => p.text)).toEqual([
      "• Think of their four themes.",
      "• Add two more power tags to each theme.",
      "• Write a Quest for each attention.",
    ]);
  });

  test("a numbered item starts a paragraph", () => {
    const lines = [body(50, 100, "The sequence is followed:"), body(50, 114, "1. TURN TO FACE"), body(50, 128, "2. PICK WEAPONS"), body(50, 142, "3. DETERMINE ATTACK DICE")];
    expect(paragraphs(parseStext(page(lines))).map((p) => p.text)).toEqual(["The sequence is followed:", "1. TURN TO FACE", "2. PICK WEAPONS", "3. DETERMINE ATTACK DICE"]);
  });

  // Necromunda's game structure: a list set in two columns under a
  // full-width intro, and the phase heading across the page below it.
  test("a line set across the columns bands the page: both columns above it come first", () => {
    const block = (...lines: string[]) => `<block>${lines.join("")}</block>`;
    const xml = `<page id="p" width="612" height="792">${[
      block(body(50, 100, "A round is split into three phases, which are resolved one at a time.")),
      block(body(50, 120, "1: PRIORITY PHASE"), body(50, 134, "Roll for Priority"), body(50, 148, "Ready Fighters")),
      block(body(320, 120, "2: ACTION PHASE"), body(320, 134, "Activate Fighters"), body(320, 148, "3: END PHASE")),
      block(stextLine(200, 180, 24, "Display", "PRIORITY PHASE")),
      block(body(50, 220, "The Priority phase has two steps."), body(50, 234, "Then fighters are Readied.")),
      block(body(320, 220, "The Action phase follows."), body(320, 234, "Fighters activate in turn.")),
    ].join("")}</page>`;
    expect(paragraphs(parseStext(xml)).map((p) => p.text)).toEqual([
      "A round is split into three phases, which are resolved one at a time.",
      "1: PRIORITY PHASE Roll for Priority Ready Fighters",
      "2: ACTION PHASE Activate Fighters 3: END PHASE",
      "PRIORITY PHASE",
      "The Priority phase has two steps. Then fighters are Readied.",
      "The Action phase follows. Fighters activate in turn.",
    ]);
  });

  // Fallout's weapon mods: 9pt lines 15pt apart, their boxes short enough
  // that the gap between a bullet and its wrapped line passes for a paragraph's.
  test("a bullet item's wrapped line, hanging under its text, stays in the item; a hyphen before a capital stays too", () => {
    const small = (x: number, y: number, text: string) => stextLine(x, y, 9, "Alegreya-Regular", text);
    const block = (...lines: string[]) => `<block>${lines.join("")}</block>`;
    const xml = `<page id="p" width="612" height="792">${[
      block(small(80, 100, "• Barrel: Long Barrel, Ported Barrel")),
      block(small(80, 115, "• Stock: Full Stock, Marksman’s Stock, Recoil-")),
      block(small(92, 130, "Compensating Stock")),
      block(small(80, 145, "• Grip: Comfort Grip")),
      block(small(80, 175, "Every one of them is a mod.")),
    ].join("")}</page>`;
    expect(paragraphs(parseStext(xml)).map((p) => p.text)).toEqual([
      "• Barrel: Long Barrel, Ported Barrel",
      "• Stock: Full Stock, Marksman’s Stock, Recoil-Compensating Stock",
      "• Grip: Comfort Grip",
      "Every one of them is a mod.",
    ]);
  });

  test("a bullet set as a line of its own leads the line beside it, and starts a paragraph", () => {
    const lines = [
      body(50, 100, "A list of things to do, set out with bullets of their own."),
      body(50, 114, "Second line of the intro to give the column its anchor."),
      body(58, 132, "●"),
      body(81, 130, "1: PRIORITY PHASE"),
      body(94, 146, "○"),
      body(117, 144, "Roll for Priority"),
    ];
    expect(paragraphs(parseStext(page(lines))).map((p) => p.text).slice(1)).toEqual(["● 1: PRIORITY PHASE", "○ Roll for Priority"]);
  });

  // Cyberpunk Red's weapons chapter opens "Ranged Weapons" with a drop cap
  // in a block of its own, which read as "R anged".
  test("a drop cap leads its line with no space", () => {
    const block = (...lines: string[]) => `<block>${lines.join("")}</block>`;
    const xml = `<page id="p" width="612" height="792">${[
      block(body(63, 100, "These are things that shoot, in the body type of the page.")),
      block(body(63, 114, "Guns, lasers, gyrojets, even the little hand-crossbows.")),
      block(body(63, 128, "If something comes out of it and causes damage, it is ranged.")),
      block(stextLine(60, 160, 34, "Display", "R", 22)),
      block(stextLine(82, 160, 13, "Display", "anged Weapons")),
    ].join("")}</page>`;
    expect(paragraphs(parseStext(xml)).map((p) => p.text).at(-1)).toBe("Ranged Weapons");
  });

  // Cyberpunk Red's exotic weapons: centred cells whose description sits
  // higher than its name, and a name wrapped across two blocks of its own.
  test("a table row is read left to right as one paragraph, whatever its cells' tops", () => {
    const block = (...lines: string[]) => `<block>${lines.join("")}</block>`;
    const xml = `<page id="p" width="612" height="792">${[
      block(body(50, 100, "Prose above the table, long enough to set the column edge.")),
      block(body(50, 114, "More prose above the table, running the full width.")),
      block(body(50, 128, "A third prose line so the column has its anchor.")),
      block(stextLine(112, 160, 10, "Bold", "Air Pistol"), stextLine(248, 158, 9, "Condensed", "Fires paint balls."), stextLine(460, 160, 9, "Condensed", "100eb")),
      block(stextLine(84, 180, 10, "Bold", "Rhinemetall EMG-86")),
      block(stextLine(115, 194, 10, "Bold", "Railgun")),
      block(stextLine(220, 179, 9, "Condensed", "Assault Rifle that ignores"), stextLine(260, 191, 9, "Condensed", "armor lower than SP 11."), stextLine(460, 186, 9, "Condensed", "5,000eb")),
    ].join("")}</page>`;
    expect(paragraphs(parseStext(xml)).map((p) => p.text).slice(1)).toEqual([
      "Air Pistol Fires paint balls. 100eb",
      "Rhinemetall EMG-86 Railgun Assault Rifle that ignores armor lower than SP 11. 5,000eb",
    ]);
  });
});

describe("tables", () => {
  test("pdfplumber reads a ruled table's rows with their boxes", async () => {
    const [t] = await pageTables(fixture("table.pdf"), [1]);
    expect(t?.rows.map((r) => r.cells)).toEqual([
      ["Small Gun", "Damage", "Weight", "Cost"],
      [".44 Pistol", "6", "4", "99"],
      ["Combat Rifle", "5", "11", "117"],
      ["Hunting Rifle", "6", "10", "55"],
    ]);
    expect(t?.rows[1]?.bbox[1]).toBeGreaterThan(t!.rows[0]!.bbox[1]);
  });

  test("a page's paragraphs carry the table as a record a row, in its place, its lines out of the prose", async () => {
    const paras = await pageParagraphs(fixture("table.pdf"), 1);
    expect(paras.map((p) => p.text)).toEqual([
      "Field Catalogue Tables",
      "Small Guns",
      "Every small gun below is available to any crew with the caps to spare, listed with its figures.",
      '{"Small Gun":".44 Pistol","Damage":"6","Weight":"4","Cost":"99"}',
      '{"Small Gun":"Combat Rifle","Damage":"5","Weight":"11","Cost":"117"}',
      '{"Small Gun":"Hunting Rifle","Damage":"6","Weight":"10","Cost":"55"}',
      "The table ends here and the prose goes on for a line or two more.",
    ]);
    expect(paras[3]?.table).toEqual({ heads: ["Small Gun", "Damage", "Weight", "Cost"], cells: [".44 Pistol", "6", "4", "99"] });
    // A box a cell, left to right, each naming its column, so a passage can mark only some.
    const boxes = paras[3]!.lines;
    expect(boxes.map((b) => b.cell)).toEqual([0, 1, 2, 3]);
    expect(boxes.every((b, i) => b.page === 1 && (i === 0 || b.x0 >= boxes[i - 1]!.x1 - 1))).toBe(true);
  });

  // Cyberpunk Red's ranged weapons: a row of one cell under each weapon, an
  // empty head, and two lists side by side under the same heads elsewhere.
  test("a row of one cell is a line of its own; an empty head is numbered, a repeated one too", () => {
    const table: Table = {
      page: 1,
      bbox: [50, 90, 400, 160],
      rows: [
        { cells: ["Weapon Type", "", "Cost", "Weapon Type"], bbox: [50, 90, 400, 110] },
        { cells: ["Medium Pistol", "", "50eb", "Heavy"], bbox: [50, 110, 400, 130] },
        { cells: ["Alt. Fire Modes: None", "", "", ""], bbox: [50, 130, 400, 145] },
        { cells: ["", "", "", ""], bbox: [50, 145, 400, 160] },
      ],
    };
    const body = (x: number, y: number, text: string) => stextLine(x, y, 12, "Alegreya-Regular", text);
    const xml = page([body(50, 60, "Prose above the table."), body(60, 115, "Medium Pistol"), body(50, 200, "Prose below the table.")]);
    expect(paragraphs(parseStext(xml), 1, [table]).map((p) => p.text)).toEqual([
      "Prose above the table.",
      '{"Weapon Type":"Medium Pistol","Cost":"50eb","Weapon Type 2":"Heavy"}',
      "Alt. Fire Modes: None",
      "Prose below the table.",
    ]);
  });
});

describe("styledCandidates", () => {
  const body = (x: number, y: number, text: string, font = "Alegreya-Regular") => stextLine(x, y, 12, font, text);

  // A book that styles its entries puts every name in a font of its own.
  test("takes the runs set apart from the prose, lead-ins included, leaders stripped", () => {
    const lines = [
      body(50, 60, "You are trained in several skills, which encompass the various activities you have picked up."),
      body(50, 74, "Each skill is ranked from zero to six, with each rank a differing degree of training you have."),
      stextLine(50, 103, 12, "Alegreya-Bold", "COMPEL:") .replace("</line>", "") + `<font name="Alegreya-Regular" size="12"><char c=" " quad="92 103 96 103 92 115 96 115"/><char c="M" quad="96 103 102 103 96 115 102 115"/></font></line>`,
      stextLine(50, 145, 14, "FuturaPT-Bold", "Athletics........DEX"),
      stextLine(50, 187, 14, "FuturaPT-Bold", "Brawling (x2)........BODY"),
      stextLine(50, 210, 14, "FuturaPT-Bold", "Wilderness Survival (x2)........................................INT"),
      body(50, 230, "42"),
    ];
    expect(styledCandidates(parseStext(page(lines)), 1)).toEqual([
      { text: "COMPEL", style: "Alegreya-Bold 12 lead-in" },
      { text: "Athletics", style: "FuturaPT-Bold 14" },
      { text: "Brawling", style: "FuturaPT-Bold 14" },
      { text: "Wilderness Survival", style: "FuturaPT-Bold 14" },
    ]);
  });

  // The bug this guards: the prose style was the page's commonest, and on a
  // page that is all list, the kits themselves were dropped as prose.
  test("finds the prose style among the long lines only", () => {
    const lines = ["Alderperson", "Fugitive", "Hardworking Drudge", "Landed Noble"].map((t, i) => stextLine(50, 100 + i * 14, 11, "Labrada-Italic", t));
    expect(styledCandidates(parseStext(page(lines)), 1).map((c) => c.text)).toEqual(["Alderperson", "Fugitive", "Hardworking Drudge", "Landed Noble"]);
  });
});

describe("pageParagraphs", () => {
  test("reads a fixture page", async () => {
    const paras = await pageParagraphs(fixture("manual.pdf"), 3);
    expect(paras.map((p) => p.text.slice(0, 22))).toEqual(["Chapter III: Radiation", "Radiation damage is pe", "RadAway is stocked in "]);
  });
});
