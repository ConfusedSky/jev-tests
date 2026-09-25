/**
 * The page images the UI server keeps on disk, held to a cap in bytes: the
 * least recently shown go first, and a PDF's drawings go once the PDF changes.
 */
import { readdir, rm, stat, utimes } from "node:fs/promises";

/** The cap, in megabytes, when JEV_PAGE_CACHE_MB sets none. */
export const PAGE_CACHE_MB = 300;

/** The cap in bytes: `mb` megabytes when it is a number, else the default. */
export function capOf(mb: string | undefined): number {
  const n = Number(mb);
  return (mb?.trim() && Number.isFinite(n) && n >= 0 ? n : PAGE_CACHE_MB) * 1e6;
}

/** What a PDF's drawings are named by: its path's hash, which has no "-" in it. */
export const pdfKey = (pdf: string) => Bun.hash(pdf).toString(36);

const version = (pdf: string, mtime: number) => `${pdfKey(pdf)}-${Math.round(mtime).toString(36)}-`;
/** A drawing's file name: its PDF, the PDF's mtime, the page and the width, the PDF first so all its drawings share a prefix. */
export const drawingName = (pdf: string, mtime: number, page: number, width: number) => `${version(pdf, mtime)}${page}-${width}.png`;

/**
 * The files to delete, oldest first, for `files`, least recently used first,
 * to fit in `cap` bytes. The newest stays even alone over the cap: it is the
 * one being shown.
 */
export function overflow(files: [name: string, bytes: number][], cap: number): string[] {
  let total = files.reduce((n, [, b]) => n + b, 0);
  const out: string[] = [];
  for (const [name, bytes] of files.slice(0, -1)) {
    if (total <= cap) break;
    out.push(name);
    total -= bytes;
  }
  return out;
}

/** The drawings among `names` of the PDF `pdf` as it was before its mtime became `mtime`. */
export function staleOf(names: Iterable<string>, pdf: string, mtime: number): string[] {
  const [mine, now] = [`${pdfKey(pdf)}-`, version(pdf, mtime)];
  return [...names].filter((n) => n.startsWith(mine) && !n.startsWith(now));
}

export class PageCache {
  /** Each drawing's size in bytes, least recently shown first. */
  private files = new Map<string, number>();
  bytes = 0;

  constructor(
    readonly dir: string,
    readonly cap: number,
  ) {}

  /** Takes in the drawings already on disk, oldest shown first (`use` stamps each as it is shown), and drops what is over the cap. */
  async load(): Promise<void> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    const found: [string, number, number][] = [];
    for (const name of names.filter((n) => n.endsWith(".png"))) {
      const s = await stat(`${this.dir}/${name}`).catch(() => undefined);
      if (s?.isFile()) found.push([name, s.size, s.mtimeMs]);
    }
    for (const [name, bytes] of found.sort((a, b) => a[2] - b[2])) this.add(name, bytes);
    this.trim();
  }

  /** `name` shown just now, `bytes` long; what is then over the cap goes. */
  use(name: string, bytes: number): void {
    this.add(name, bytes);
    // Stamped, so a server started later knows what was shown last.
    const now = new Date();
    void utimes(`${this.dir}/${name}`, now, now).catch(() => {});
    this.trim();
  }

  /** Drops the drawings of `pdf` made before it changed to `mtime`. */
  forget(pdf: string, mtime: number): void {
    for (const name of staleOf(this.files.keys(), pdf, mtime)) this.drop(name);
  }

  private add(name: string, bytes: number) {
    this.bytes += bytes - (this.files.get(name) ?? 0);
    this.files.delete(name);
    this.files.set(name, bytes);
  }

  private drop(name: string) {
    this.bytes -= this.files.get(name) ?? 0;
    this.files.delete(name);
    void rm(`${this.dir}/${name}`, { force: true });
  }

  private trim() {
    for (const name of overflow([...this.files], this.cap)) this.drop(name);
  }
}
