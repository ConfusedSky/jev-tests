import { describe, expect, test } from "bun:test";
import { pageParagraphs, paragraphs, parseStext, type Line } from "./layout";

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
    expect(lines).toEqual([{ x0: 50, y0: 100, x1: 92, y1: 112, size: 12, spans: [{ text: "COMPEL:", bold: true, italic: false }] }]);
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
});

describe("pageParagraphs", () => {
  test("reads a fixture page", async () => {
    const paras = await pageParagraphs(fixture("manual.pdf"), 3);
    expect(paras.map((p) => p.text.slice(0, 22))).toEqual(["Chapter III: Radiation", "Radiation damage is pe", "RadAway is stocked in "]);
  });
});
