import { describe, expect, test } from "bun:test";
import { pageParagraphs, paragraphs, parseStext, styledCandidates, tables } from "./layout";

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
  const block = (...lines: string[]) => `<block>${lines.join("")}</block>`;
  const cell = (x: number, y: number, text: string, font = "Book") => stextLine(x, y, 9, font, text, 4.5);

  // Fallout's small guns: heads two lines tall, a name column, wrapped cells,
  // the dice glyph in display type, and the rarity column hugging the margin.
  test("reads a table with two-line heads and wrapped cells into a record a row", () => {
    const xml = `<page id="p" width="612" height="792">${[
      block(cell(85, 101, "SMALL GUN", "Bold"), cell(162, 95, "WEAPON", "Bold"), cell(169, 106, "TYPE", "Bold"), cell(206, 95, "DAMAGE", "Bold"), cell(208, 106, "RATING", "Bold"), cell(454, 101, "WEIGHT", "Bold"), cell(490, 101, "COST", "Bold"), cell(530, 101, "RARITY", "Bold")),
      block(cell(85, 128, ".44 Pistol"), cell(167, 122, "Small"), cell(167, 136, "Guns"), cell(212, 127, "6 D"), stextLine(226, 128, 13, "Dice", "C"), cell(466, 129, "4"), cell(494, 129, "99"), cell(540, 129, "2")),
      block(cell(85, 165, "10mm Pistol"), cell(167, 158, "Small"), cell(167, 172, "Guns"), cell(212, 163, "4 D"), stextLine(226, 164, 13, "Dice", "C"), cell(466, 166, "4"), cell(494, 166, "50"), cell(540, 166, "1")),
    ].join("")}</page>`;
    const [t] = tables(parseStext(xml).lines, 9);
    expect(t?.columns).toEqual(["SMALL GUN", "WEAPON TYPE", "DAMAGE RATING", "WEIGHT", "COST", "RARITY"]);
    expect(t?.rows.map((r) => r.cells)).toEqual([
      { "SMALL GUN": ".44 Pistol", "WEAPON TYPE": "Small Guns", "DAMAGE RATING": "6 D C", WEIGHT: "4", COST: "99", RARITY: "2" },
      { "SMALL GUN": "10mm Pistol", "WEAPON TYPE": "Small Guns", "DAMAGE RATING": "4 D C", WEIGHT: "4", COST: "50", RARITY: "1" },
    ]);
  });

  // Cyberpunk Red's exotic weapons: centred cells, bold names, one name over
  // three lines set as far apart as the rows are.
  test("a name wrapped over lines as far apart as rows joins the row its data sits on", () => {
    const xml = `<page id="p" width="612" height="792">${[
      block(cell(63, 60, "How to read the table, in the body type, long enough to be prose.")),
      block(cell(113, 100, "Weapon", "Bold"), cell(272, 100, "Description and Data", "Bold"), cell(474, 100, "Cost", "Bold")),
      block(cell(112, 120, "Air Pistol", "Bold"), cell(248, 119, "Very Heavy Pistol that fires balls."), cell(459, 120, "100eb")),
      block(cell(91, 137, "Constitution Arms", "Bold"), cell(91, 150, "Hurricane Assault", "Bold")),
      block(cell(113, 164, "Weapon", "Bold")),
      block(cell(254, 148, "Shotgun w/ 2 ROF."), cell(459, 150, "5,000eb")),
      block(cell(114, 181, "Dartgun", "Bold"), cell(256, 178, "Fires Non-Basic Arrows."), cell(459, 180, "100eb")),
      block(stextLine(63, 220, 14, "Bold", "Melee Weapons")),
      block(cell(63, 240, "The prose that follows the table runs the width of the page and more.")),
    ].join("")}</page>`;
    const [t] = tables(parseStext(xml).lines, 9);
    expect(t?.rows.map((r) => r.cells.Weapon)).toEqual(["Air Pistol", "Constitution Arms Hurricane Assault Weapon", "Dartgun"]);
    expect(t?.rows[1]?.cells).toEqual({ Weapon: "Constitution Arms Hurricane Assault Weapon", "Description and Data": "Shotgun w/ 2 ROF.", Cost: "5,000eb" });
    expect(t?.lines.some((l) => l.y0 >= 220)).toBe(false);
  });

  test("two lists side by side under the same heads keep their cells apart", () => {
    const xml = `<page id="p" width="612" height="792">${[
      block(cell(60, 100, "Skill", "Bold"), cell(150, 100, "Level", "Bold"), cell(300, 100, "Skill", "Bold"), cell(390, 100, "Level", "Bold")),
      block(cell(60, 120, "Athletics"), cell(150, 120, "4"), cell(300, 120, "Perception"), cell(390, 120, "6")),
      block(cell(60, 137, "Brawling"), cell(150, 137, "2"), cell(300, 137, "Stealth"), cell(390, 137, "3")),
    ].join("")}</page>`;
    const [t] = tables(parseStext(xml).lines, 9);
    expect(t?.columns).toEqual(["Skill", "Level", "Skill 2", "Level 2"]);
    expect(t?.rows[0]?.cells).toEqual({ Skill: "Athletics", Level: "4", "Skill 2": "Perception", "Level 2": "6" });
  });

  test("bold lead-ins one under another are a list, not a table", () => {
    const xml = page([cell(50, 100, "COMPEL:", "Bold"), cell(50, 114, "DELVE:", "Bold"), cell(50, 128, "ENDURE:", "Bold")]);
    expect(tables(parseStext(xml).lines, 9)).toEqual([]);
  });

  test("a page's paragraphs carry the table as a record a row, in its place, each row one unit", () => {
    const xml = `<page id="p" width="612" height="792">${[
      block(cell(60, 60, "Weapons are listed below, with their cost and weight in the table.")),
      block(cell(60, 100, "Name", "Bold"), cell(200, 100, "Cost", "Bold"), cell(300, 100, "Weight", "Bold")),
      block(cell(60, 120, "Pistol"), cell(200, 120, "99"), cell(300, 120, "4")),
      block(cell(60, 137, "Rifle"), cell(200, 137, "117"), cell(300, 137, "11")),
      block(cell(60, 180, "Prose after the table, wide enough to run past the second column edge.")),
    ].join("")}</page>`;
    const paras = paragraphs(parseStext(xml));
    expect(paras.map((p) => p.text)).toEqual([
      "Weapons are listed below, with their cost and weight in the table.",
      '{"Name":"Pistol","Cost":"99","Weight":"4"}',
      '{"Name":"Rifle","Cost":"117","Weight":"11"}',
      "Prose after the table, wide enough to run past the second column edge.",
    ]);
    expect(paras[1]?.table).toBe(true);
    expect(paras[1]?.lines).toHaveLength(3);
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
