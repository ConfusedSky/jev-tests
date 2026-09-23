/**
 * A page as mutool sees it: lines with positions and fonts, put back into
 * columns and paragraphs, with the weight of every character kept. This is
 * what a passage is read from and printed with. The -layout text the walk
 * gates on keeps a table's row on one line but knows nothing of weight.
 */

export type Span = { text: string; bold: boolean; italic: boolean };
export type Line = { x0: number; y0: number; x1: number; y1: number; size: number; spans: Span[] };
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
  for (const [, head, body] of xml.matchAll(/<line ([^>]*)>(.*?)<\/line>/gs)) {
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
      if (last && last.bold === bold && last.italic === italic) last.text += text;
      else spans.push({ text, bold, italic });
    }
    const size = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    if (spans.some((s) => s.text.trim())) lines.push({ x0, y0, x1, y1, size, spans });
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
export function paragraphs(page: { width: number; height: number; lines: Line[] }, pageNumber = 0): Para[] {
  const { height, lines: all } = page;
  if (all.length === 0) return [];
  const body = mode(all.map((l) => Math.round(l.size)));
  // A running header or page number sits in the top or bottom margin in
  // modest type, or hugs the right edge whatever its type; a chapter title
  // sits up there too, in display type, and stays.
  const { width } = page;
  const lines = all.filter((l) => !(((l.y0 < height * 0.06 || l.y1 > height * 0.96) && l.size < body * 1.5) || l.x0 > width * 0.85));
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
  const ordered = [...lines].sort((a, b) => column(a) - column(b) || a.y0 - b.y0 || a.x0 - b.x0);

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
      const bullet = /^[•·▪‣□-]/.test(text(l).trim());
      if (newColumn || gap || resize || bullet) flush();
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

/** The paragraphs of one page of a PDF, via mutool. */
export async function pageParagraphs(pdf: string, page: number): Promise<Para[]> {
  const p = Bun.spawn(["mutool", "draw", "-F", "stext", "-o", "-", pdf, String(page)], { stdout: "pipe", stderr: "pipe" });
  const [xml, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if ((await p.exited) !== 0) throw new Error(`mutool failed: ${err.trim()}`);
  return paragraphs(parseStext(xml), page);
}
