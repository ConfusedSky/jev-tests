/**
 * A page as mutool sees it: lines with positions and fonts, put back into
 * columns and paragraphs, with the weight of every character kept. This is
 * what a passage is read from and printed with. The -layout text the walk
 * gates on keeps a table's row on one line but knows nothing of weight.
 */

export type Span = { text: string; bold: boolean; italic: boolean; font: string };
/** `block` is the mutool block the line came from. */
export type Line = { x0: number; y0: number; x1: number; y1: number; size: number; spans: Span[]; block: number };
/** A line's box, the page it is on, and which characters of its paragraph's text it holds. */
export type Box = { page: number; x0: number; y0: number; x1: number; y1: number; start: number; end: number };
/**
 * A paragraph's text with, per character, "b" for bold, "i" for italic, "B"
 * for both and " " for neither, and the boxes of its lines for highlighting.
 */
export type Para = { heading: boolean; text: string; style: string; lines: Box[] };

const attr = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1];
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (s: string) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16))).replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENTITIES[e]!);

// mutool drops the space between two words when their gap is narrow, and on
// Heart's pages that glued half of every line. The gap is still there in the
// character boxes: a tenth of the font size or more is a word break; the
// gaps inside a word stay under a twelfth, a missing space is an eighth.
const WORD_GAP = 0.1;

/** The lines of one page from `mutool draw -F stext`. */
export function parseStext(xml: string): { width: number; height: number; lines: Line[] } {
  const page = /<page [^>]*>/.exec(xml)?.[0] ?? "";
  const width = Number(attr(page, "width") ?? 0);
  const height = Number(attr(page, "height") ?? 0);
  const lines: Line[] = [];
  let block = 0;
  for (const [, blockXml] of xml.matchAll(/<block\b[^>]*>(.*?)<\/block>/gs)) {
    block++;
    for (const [, head, body] of blockXml!.matchAll(/<line ([^>]*)>(.*?)<\/line>/gs)) {
      const [x0, y0, x1, y1] = (attr(head!, "bbox") ?? "0 0 0 0").split(" ").map(Number) as [number, number, number, number];
      const spans: Span[] = [];
      // The line's size is that of most of its characters, so a superscript
      // or a dingbat bullet in a larger font does not make it a heading.
      const sizes = new Map<number, number>();
      let prevRight: number | undefined;
      for (const [, fontTag, chars] of body!.matchAll(/<font ([^>]*)>(.*?)<\/font>/gs)) {
        const name = attr(fontTag!, "name") ?? "";
        const bold = /bold|heavy|black|semibold|demi|extrab/i.test(name);
        const italic = /italic|oblique/i.test(name);
        const size = Number(attr(fontTag!, "size") ?? 0);
        let text = "";
        for (const [, tag] of chars!.matchAll(/<char ([^>]*)\/>/g)) {
          // A private-use glyph is a dingbat, a bullet as often as not.
          const c = unescape(attr(tag!, "c") ?? "").replace(/[\uE000-\uF8FF\uFFFD]/g, "•");
          sizes.set(size, (sizes.get(size) ?? 0) + 1);
          const quad = (attr(tag!, "quad") ?? "").split(" ").map(Number);
          const left = quad[0] ?? 0;
          const right = quad[2] ?? left;
          if (prevRight !== undefined && c !== " " && !text.endsWith(" ") && left - prevRight > WORD_GAP * size) text += " ";
          text += c;
          prevRight = right;
        }
        if (!text) continue;
        const last = spans.at(-1);
        if (last && last.font === name) last.text += text;
        else spans.push({ text, bold, italic, font: name });
      }
      const size = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
      if (spans.some((s) => s.text.trim())) lines.push({ x0, y0, x1, y1, size, spans, block });
    }
  }
  return { width, height, lines };
}

const text = (l: Line) => l.spans.map((s) => s.text).join("");

/**
 * Lines into reading order and paragraphs. Columns are the distinct left
 * edges most lines share, read left to right and down; a line in the top or
 * bottom margin in less than display type is a running header or page
 * number and is dropped. A paragraph ends at a gap wider than the line pitch, a
 * change of size, or a bullet; a line in type well above the body's is a
 * heading of its own.
 */
const BULLET = /^[•·▪‣□●○■◆◇▫⁃◦-]/;
const BULLET_ONLY = /^[•·▪‣□●○■◆◇▫⁃◦-]$/;

export function paragraphs(page: { width: number; height: number; lines: Line[] }, pageNumber = 0): Para[] {
  const { height, lines: all } = page;
  if (all.length === 0) return [];
  const body = mode(all.map((l) => Math.round(l.size)));
  // A running header or page number sits in the top or bottom margin in
  // modest type, or hugs the right edge whatever its type; a chapter title
  // sits up there too, in display type, and stays.
  const { width } = page;
  let lines = all.filter((l) => !(((l.y0 < height * 0.06 || l.y1 > height * 0.96) && l.size < body * 1.5) || l.x0 > width * 0.85));
  // A bullet set as a line of its own leads the line beside it; left apart,
  // the two sit side by side and read as a table row. A drop cap is a letter
  // of its own in display type, flush against the line it opens, in a block
  // of its own; it leads that line with no space between.
  const overlap = (a: Line, b: Line) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > Math.min(a.y1 - a.y0, b.y1 - b.y0) / 2;
  const cap = (l: Line) => /^\p{L}$/u.test(text(l).trim()) && l.size > body * 1.5;
  const lead = (l: Line) => BULLET_ONLY.test(text(l).trim()) || cap(l);
  for (const g of lines.filter(lead)) {
    const mate = lines
      .filter((l) => l !== g && !lead(l) && l.x0 > g.x0 && overlap(l, g) && (cap(g) ? l.x0 - g.x1 < body * 0.3 : l.block === g.block))
      .sort((a, b) => a.x0 - b.x0)[0];
    if (!mate) continue;
    mate.spans.unshift(...g.spans, ...(cap(g) ? [] : [{ text: " ", bold: false, italic: false, font: "" }]));
    mate.x0 = g.x0;
    lines = lines.filter((l) => l !== g);
  }
  // Column anchors: left edges within a body-size of each other are one edge;
  // an edge fewer than three lines start at is an indent, not a column, and
  // so is one the lines of the column before mostly run past: a bullet
  // list's wrapped lines hang two ems in and are not a second column.
  const anchors: number[] = [];
  const near = (x: number) => lines.filter((l) => Math.abs(l.x0 - x) < body * 1.5);
  for (const x of [...lines.map((l) => l.x0)].sort((a, b) => a - b)) {
    const prev = anchors.at(-1);
    if (prev !== undefined && x - prev < body * 1.5) continue;
    if (near(x).length < 3) continue;
    if (prev !== undefined) {
      const before = near(prev);
      if (before.filter((l) => l.x1 > x + body).length > before.length * 0.4) continue;
    }
    anchors.push(x);
  }
  const column = (l: Line) => {
    let best = 0;
    for (const [i, a] of anchors.entries()) if (a <= l.x0 + body * 0.5) best = i;
    return best;
  };
  // A line set across two columns, a heading or an intro, bands the page:
  // what stands above it in either column is read before it.
  const wide = anchors.length > 1 ? lines.filter((l) => l.x0 < anchors[1]! && l.x1 > anchors[1]! + body).map((l) => l.y0) : [];
  const band = (y: number) => wide.filter((w) => w <= y + 0.5).length;
  // A centred table cell's top says nothing of its row, but mutool keeps a
  // cell's lines in one block. Blocks of one column whose spans overlap are
  // one row; a row with two lines side by side, overlapping by more than
  // tight leading does, is a table row, read block by block left to right,
  // each block's lines in mutool's order.
  type Block = { col: number; x0: number; y0: number; y1: number; lines: Line[]; row: number; table: boolean };
  const blockOf = new Map<Line, Block>();
  const byKey = new Map<string, Block>();
  for (const l of lines) {
    const key = `${l.block} ${column(l)}`;
    let b = byKey.get(key);
    if (!b) byKey.set(key, (b = { col: column(l), x0: l.x0, y0: l.y0, y1: l.y1, lines: [], row: 0, table: false }));
    b.x0 = Math.min(b.x0, l.x0);
    b.y0 = Math.min(b.y0, l.y0);
    b.y1 = Math.max(b.y1, l.y1);
    b.lines.push(l);
    blockOf.set(l, b);
  }
  const rows: Block[][] = [];
  for (const b of [...byKey.values()].sort((a, b) => band(a.y0) - band(b.y0) || a.col - b.col || a.y0 - b.y0)) {
    const r = rows.at(-1);
    if (r && r[0]!.col === b.col && band(r[0]!.y0) === band(b.y0) && b.y0 < Math.max(...r.map((x) => x.y1))) r.push(b);
    else rows.push([b]);
  }
  for (const [i, r] of rows.entries()) {
    const ls = r.flatMap((b) => b.lines);
    const beside = (a: Line, b: Line) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > Math.min(a.y1 - a.y0, b.y1 - b.y0) / 2;
    const table = ls.some((a, i) => ls.some((b, j) => j > i && beside(a, b)));
    for (const b of r) Object.assign(b, { row: i, table });
  }
  const index = new Map(lines.map((l, i) => [l, i]));
  const ordered = [...lines].sort((a, b) => {
    const [ba, bb] = [blockOf.get(a)!, blockOf.get(b)!];
    if (ba.row !== bb.row) return ba.row - bb.row;
    if (!ba.table) return a.y0 - b.y0 || a.x0 - b.x0;
    return ba === bb ? index.get(a)! - index.get(b)! : ba.x0 - bb.x0;
  });

  const out: Para[] = [];
  let cur: Line[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    const heading = cur.every((l) => l.size >= body * 1.25);
    let t = "";
    let st = "";
    const boxes: Box[] = [];
    for (const [i, l] of cur.entries()) {
      // Each line's text is tidied on its own, so a line's characters stay a
      // known range of the paragraph's.
      let lt = "";
      let ls = "";
      for (const s of l.spans) {
        lt += s.text;
        ls += (s.bold && s.italic ? "B" : s.bold ? "b" : s.italic ? "i" : " ").repeat(s.text.length);
      }
      [lt, ls] = tidy(lt, ls);
      if (!lt) continue;
      const start = t.length;
      t += lt;
      st += ls;
      boxes.push({ page: pageNumber, x0: l.x0, y0: l.y0, x1: l.x1, y1: l.y1, start, end: t.length });
      if (i < cur.length - 1) {
        // A word broken at the margin is mended; otherwise the break is a space.
        if (/[\p{L}][‐\u00ad-]$/u.test(t)) {
          t = t.slice(0, -1);
          st = st.slice(0, -1);
          boxes.at(-1)!.end--;
        } else {
          t += " ";
          st += " ";
        }
      }
    }
    if (t.endsWith(" ")) {
      t = t.slice(0, -1);
      st = st.slice(0, -1);
    }
    out.push({ heading, text: t, style: st, lines: boxes });
    cur = [];
  };
  for (const l of ordered) {
    const prev = cur.at(-1);
    if (prev) {
      const pitch = Math.max(prev.y1 - prev.y0, l.y1 - l.y0);
      const newColumn = column(prev) !== column(l);
      const gap = l.y0 - prev.y1 > pitch * 0.6;
      const resize = Math.abs(l.size - prev.size) > 0.5;
      const bullet = BULLET.test(text(l).trim());
      // A table row is one paragraph, whatever its cells' gaps and sizes.
      const [bp, bl] = [blockOf.get(prev)!, blockOf.get(l)!];
      if (bp.row !== bl.row ? bp.table || bl.table || newColumn || gap || resize || bullet : !bl.table && (gap || resize || bullet)) flush();
    }
    cur.push(l);
  }
  flush();
  return out.filter((p) => p.text.length > 0);
}

/** Trims and single-spaces `text`, keeping `style` in step; a space keeps its span's weight. */
function tidy(text: string, style: string): [string, string] {
  let t = "";
  let s = "";
  let inSpace = true;
  for (let i = 0; i < text.length; i++) {
    const ws = /\s/.test(text[i]!);
    if (ws && inSpace) continue;
    t += ws ? " " : text[i];
    s += style[i];
    inSpace = ws;
  }
  return t.endsWith(" ") ? [t.slice(0, -1), s.slice(0, -1)] : [t, s];
}

function mode(xs: number[]): number {
  const n = new Map<number, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
}

/** A run of text set in one style, the whole of a line or its lead-in, as a candidate entry name. */
export type Styled = { style: string; text: string; page: number };

/**
 * The runs a page sets apart by type: a whole line in one font, or the bold
 * lead-in of a body line ("BLOCK: +1 Blood protection"). A book that
 * styles its entries puts every entry name in one such style, and none of
 * its prose, so the entries can be counted by style once jev names which.
 */
// Dot leaders and what follows them ("Athletics........DEX") and a note
// ("Martial Arts (x2)") are not the name; off before any length is measured,
// since the leaders make a name's line as long as a line of prose.
const bare = (t: string) => t.replace(/\s*\.{3,}.*$/, "").replace(/\s*\([^)]*\)\s*$/, "").replace(/[:.]$/, "").trim();

export function styledRuns(lines: Line[], pageNumber: number): Styled[] {
  const out: Styled[] = [];
  for (const l of lines) {
    const spans = l.spans.filter((s) => s.text.trim());
    if (spans.length === 0) continue;
    const key = (s: Span) => `${s.font} ${Math.round(l.size)}`;
    if (spans.every((s) => s.font === spans[0]!.font)) {
      const text = bare(spans.map((s) => s.text).join(""));
      if (text && text.length <= 60) out.push({ style: key(spans[0]!), text, page: pageNumber });
      continue;
    }
    const lead = spans[0]!;
    if (lead.bold && !spans[1]!.bold) {
      const text = bare(lead.text);
      if (text) out.push({ style: `${key(lead)} lead-in`, text, page: pageNumber });
    }
  }
  return out;
}

/**
 * The names a page sets apart by type, as a count's candidates: its styled
 * runs outside the prose styles, where a prose style is one a fifth or more
 * of the page's long lines are set in (Cyberpunk Red describes its skills in
 * a book face and an oblique one), so a page that is all list keeps its
 * list. A page with no such runs lists its entries inline, and the count
 * falls back to the text's scraps.
 */
export function styledCandidates(page: { lines: Line[] }, pageNumber: number): { text: string; style: string }[] {
  const prose = new Map<string, number>();
  let long = 0;
  for (const l of page.lines) {
    if (bare(text(l)).length <= 60) continue;
    for (const s of l.spans) {
      const k = `${s.font} ${Math.round(l.size)}`;
      prose.set(k, (prose.get(k) ?? 0) + s.text.length);
      long += s.text.length;
    }
  }
  const body = new Set([...prose.entries()].filter(([, n]) => n >= long * 0.2).map(([k]) => k));
  const seen = new Set<string>();
  const out: { text: string; style: string }[] = [];
  for (const r of styledRuns(page.lines, pageNumber)) {
    if (body.has(r.style) || r.text.length < 2 || /^\d+$/.test(r.text) || seen.has(r.text.toLowerCase())) continue;
    seen.add(r.text.toLowerCase());
    out.push({ text: r.text, style: r.style });
  }
  return out;
}

/** The lines of one page of a PDF, via mutool, with the page's size. */
export async function pageLines(pdf: string, page: number): Promise<{ width: number; height: number; lines: Line[] }> {
  const p = Bun.spawn(["mutool", "draw", "-F", "stext", "-o", "-", pdf, String(page)], { stdout: "pipe", stderr: "pipe" });
  const [xml, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if ((await p.exited) !== 0) throw new Error(`mutool failed: ${err.trim()}`);
  return parseStext(xml);
}

/** The paragraphs of one page of a PDF, via mutool. */
export async function pageParagraphs(pdf: string, page: number): Promise<Para[]> {
  return paragraphs(await pageLines(pdf, page), page);
}
