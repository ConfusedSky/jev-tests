/**
 * The page viewer's arithmetic: which pages of a run are highlighted and in
 * what order, where each page sits in a column of pages, how a mark in PDF
 * points lands on a page drawn at any size, and what width to draw it at.
 */
import { hitText } from "./history";
import { factsOf, walkOf, type Read } from "./log";
import type { Run } from "./run";
import type { JsonHit, Mark, PageSize } from "./types";
import { plainTitle } from "./util";

/**
 * A highlighted page of a run, an entry in the viewer's list: one page of
 * one answer, with the marks the answer has there. `key` names the answer,
 * `h0` for the first hit or `c1-2` for a table's cell, and is shared by
 * every page of it.
 */
export type Spot = {
  key: string;
  pdf: string;
  page: number;
  section: string;
  /** The answer in a few words. */
  snippet: string;
  marks: Mark[];
  /** The page's size in the marks' units, as the tool read it. */
  size?: PageSize;
  /** Why nothing is marked, when nothing is. */
  unmarked?: string;
  /** A table cell's row and column. */
  cell?: string;
};

const clip = (s: string, n = 90) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n).replace(/\s\S*$/, "")}…` : t;
};

/** Why a hit has nothing marked on its page, or undefined when it has marks. */
export function whyUnmarked(h: JsonHit, kind: string | undefined, contents: boolean): string | undefined {
  // Read from storage, a run saved before the tools reported marks has none at all.
  if (h.marks === undefined) return "this run was saved before highlights were kept with each run";
  if (h.marks.length > 0) return undefined;
  if (contents) return "read off the table of contents; the page shown is where the section starts";
  if (kind === "truth") return "a statement rests on no single line, so nothing is marked";
  if (!h.answer) return "this page passed the gate; nothing was read off it";
  return "the answer's text was not found on the page's lines";
}

/** A hit's page sizes; a run saved while they were called `pages` has them under that name, beside the answer's own list of pages. */
export function sizesOf(h: JsonHit): Record<number, PageSize> | undefined {
  const old = (h as JsonHit & { pages?: unknown }).pages;
  return h.sizes ?? (typeof old === "object" && old !== null && !Array.isArray(old) ? (old as Record<number, PageSize>) : undefined);
}

/** A hit's pages, each with its own marks, in page order; a hit with no marks is its own page, unmarked. */
function hitSpots(h: JsonHit, key: string, kind: string | undefined, contents: boolean, cell?: string): Spot[] {
  const base = { key, pdf: h.pdf, section: plainTitle(h.section), snippet: clip(hitText(h)), ...(cell && { cell }) };
  const unmarked = whyUnmarked(h, kind, contents);
  if (unmarked) return [{ ...base, page: h.page, marks: [], unmarked }];
  const pages = [...new Set(h.marks.map((m) => m.page))].sort((a, b) => a - b);
  const sizes = sizesOf(h);
  return pages.map((page) => ({ ...base, page, marks: h.marks.filter((m) => m.page === page), size: sizes?.[page] }));
}

/** What a stopped walk had taken last before the stop, and in which PDF: never weighed against the rest of the walk. */
export function leadOf(run: Run): { pdf?: string; read: Read } | undefined {
  const w = walkOf(run.lines);
  return w.files.flatMap((f) => f.reads.filter((r) => r.verdict === "take").map((read) => ({ pdf: f.path ?? run.request.pdf, read }))).at(-1);
}

/** Every highlighted page of a run, in the order its answers came: each hit's pages, a table's cells row by row, or what a stopped walk had taken. */
export function spotsOf(run: Run): Spot[] {
  const r = run.end?.report;
  const toc = factsOf(run.lines).toc ?? [];
  // A hit the contents answered names the section and the answer a toc line of the log does.
  const contents = (h: JsonHit) => toc.some((t) => t.section === h.section && t.text === h.answer?.text);
  const table = r?.table;
  if (table)
    return table.rows.flatMap((row, i) =>
      table.columns.flatMap((column, j) => {
        const c = table.cells[i]![j]!;
        return c.hit ? hitSpots(c.hit, `c${i}-${j}`, c.kind, contents(c.hit), `${row} × ${column}`) : [];
      }),
    );
  if (r) return r.hits.flatMap((h, i) => hitSpots(h, `h${i}`, r.kind, contents(h)));
  const lead = run.status === "stopped" ? leadOf(run) : undefined;
  if (lead?.pdf && lead.read.page)
    return [{ key: "lead", pdf: lead.pdf, page: lead.read.page, section: plainTitle(lead.read.name), snippet: clip(lead.read.answer ?? ""), marks: [], unmarked: "the run was stopped before this was weighed, so nothing is marked" }];
  return [];
}

/** The spot `by` steps from `at` among `n`, held at either end. */
export const stepSpot = (n: number, at: number, by: 1 | -1) => Math.max(0, Math.min(n - 1, at + by));

/** Zooms offered, as multiples of the width that fits the pane. */
export const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
/** The next zoom in (`by` 1) or out (-1) from `z`, held at either end. */
export function zoomStep(z: number, by: 1 | -1): number {
  if (by > 0) return ZOOMS.find((x) => x > z + 1e-9) ?? ZOOMS[ZOOMS.length - 1]!;
  return ZOOMS.findLast((x) => x < z - 1e-9) ?? ZOOMS[0]!;
}

/**
 * The width to have a page drawn at: its width on screen in device pixels,
 * rounded up to a `step` so nearby zooms share a drawing, within what the
 * server draws.
 */
export function renderWidth(cssWidth: number, dpr: number, step = 200, min = 200, max = 2000): number {
  return Math.min(max, Math.max(min, Math.ceil((cssWidth * dpr) / step) * step));
}

/** Where each page sits in a column of pages drawn `width` wide with `gap` between them: its top and height, and the column's height. */
export function layOut(pages: [number, number][], width: number, gap: number): { tops: number[]; heights: number[]; total: number } {
  const tops: number[] = [];
  const heights: number[] = [];
  let y = 0;
  for (const [w, h] of pages) {
    tops.push(y);
    const height = w > 0 ? (width * h) / w : width;
    heights.push(height);
    y += height + gap;
  }
  return { tops, heights, total: Math.max(0, y - gap) };
}

/** The page, from 1, that holds `y` in a column laid out with `tops`: the last to start at or above it. */
export function pageAt(tops: number[], y: number): number {
  let lo = 0;
  let hi = tops.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (tops[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** A mark as percentages of its page, to lay over the page drawn at any size. */
export function placed(m: Mark, size: PageSize): { left: number; top: number; width: number; height: number } {
  return { left: (m.x0 / size.width) * 100, top: (m.y0 / size.height) * 100, width: ((m.x1 - m.x0) / size.width) * 100, height: ((m.y1 - m.y0) / size.height) * 100 };
}

/**
 * How far down a column to scroll for `spot` on a page at `top`, `height`
 * tall and of `size`: its first mark a third of the way down a view
 * `view` tall, or the page's top when nothing is marked.
 */
export function scrollFor(spot: Pick<Spot, "marks">, top: number, height: number, size: PageSize, view: number): number {
  const first = Math.min(...spot.marks.map((m) => m.y0));
  if (!Number.isFinite(first)) return Math.max(0, top - 12);
  return Math.max(0, top + (first / size.height) * height - view / 3);
}

/** The viewer's share of the width when the split is dragged to `x`, in a box starting at `left` and `width` wide, held between `min` and `max`. */
export function splitAt(x: number, left: number, width: number, min = 0.3, max = 0.7): number {
  return Math.max(min, Math.min(max, (left + width - x) / Math.max(1, width)));
}

/** The page a typed number goes to, held to the last page; none for nothing typed, or no page at all. */
export function pageInput(typed: string | undefined, count: number): number | undefined {
  const n = Number(typed?.trim() || NaN);
  return Number.isInteger(n) && n >= 1 && count >= 1 ? Math.min(n, count) : undefined;
}

/** Where a page's left edge stands in the column: centred while the page is narrower than the view, else a pad in. */
export const pageLeft = (width: number, view: number, pad: number) => Math.max(pad, (view - width) / 2);

/** A view of the column: how far it is scrolled, and its size. */
export type ViewBox = { left: number; top: number; width: number; height: number };

/**
 * A point of a page, as shares of the page's width and height, and the place
 * in the view it is to stay at, as shares of the view's: what holds the view
 * still while the pages change size.
 */
export type Anchor = { page: number; fx: number; fy: number; vx: number; vy: number };

type Laid = { lay: ReturnType<typeof layOut>; width: number; pad: number };

/** The anchor holding whatever is under (`vx`, `vy`) of the view where it is. */
export function anchorAt({ lay, width, pad }: Laid, view: ViewBox, vx: number, vy: number): Anchor {
  const y = view.top + vy * view.height - pad;
  const page = pageAt(lay.tops, y);
  const i = page - 1;
  const x = view.left + vx * view.width - pageLeft(width, view.width, pad);
  return { page, fx: x / width, fy: (y - lay.tops[i]!) / Math.max(1, lay.heights[i]!), vx, vy };
}

/** How far to scroll a view `w` by `h` for an anchor's point to stand at its place in it. */
export function scrollOf(a: Anchor, { lay, width, pad }: Laid, w: number, h: number): { left: number; top: number } {
  const i = Math.max(0, Math.min(a.page, lay.tops.length) - 1);
  return { left: pageLeft(width, w, pad) + a.fx * width - a.vx * w, top: pad + lay.tops[i]! + a.fy * lay.heights[i]! - a.vy * h };
}

/**
 * The anchor keeping `spot` in sight while the pages change size, when its
 * page is in view: the top left of its marks where it stands, brought in
 * from the view's edges so a zoom in does not push it out. None when nothing
 * is marked or the page is out of view.
 */
export function markAnchor(spot: Pick<Spot, "page" | "marks">, size: PageSize, laid: Laid, view: ViewBox): Anchor | undefined {
  const { lay, width, pad } = laid;
  const i = spot.page - 1;
  if (spot.marks.length === 0 || i >= lay.tops.length) return undefined;
  const top = pad + lay.tops[i]!;
  if (top + lay.heights[i]! < view.top || top > view.top + view.height) return undefined;
  const [fx, fy] = [Math.min(...spot.marks.map((m) => m.x0)) / size.width, Math.min(...spot.marks.map((m) => m.y0)) / size.height];
  const at = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const x = pageLeft(width, view.width, pad) + fx * width - view.left;
  const y = top + fy * lay.heights[i]! - view.top;
  return { page: spot.page, fx, fy, vx: at(x / view.width, 0.05, 0.5), vy: at(y / view.height, 0.1, 0.5) };
}
