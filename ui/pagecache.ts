/**
 * The page images the UI server keeps on disk, held to a cap in bytes: the
 * least recently shown go first, and a PDF's drawings go once the PDF changes.
 * Two servers may share the directory, each adding drawings and dropping the
 * other's, so the disk is read again before anything is dropped for room.
 */
import { mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";

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

/** A drawing is written under this ending first, then moved into place whole. */
const PART = ".part";
/** A part this old was left by a server that died drawing it; a younger one may be another server's, still being drawn. */
export const STALE_PART_MS = 10 * 60_000;

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

/** A drawing's size, and when it was last shown: by this server as it knows, or by another as the file's mtime says. */
type Kept = { bytes: number; at: number };

export class PageCache {
  /** Least recently shown first. */
  private files = new Map<string, Kept>();
  bytes = 0;
  /** When this server last showed a drawing, so each show here is later than the one before. */
  private last = 0;
  private making = new Map<string, { made: Promise<boolean>; askers: AbortSignal[] }>();
  private sweeping?: Promise<void>;
  private again?: Promise<void>;
  /** Drawings shown while a sweep reads the disk, which it may have looked for before they were drawn. */
  private shownDuring?: Set<string>;

  constructor(
    readonly dir: string,
    readonly cap: number,
  ) {}

  /**
   * Reads what is on disk again and drops what is over the cap, and any part
   * a crash left; resolves once they are gone. Asked for while one runs,
   * another follows it, since that one may have read the disk too soon.
   */
  sweep(): Promise<void> {
    if (!this.sweeping) return (this.sweeping = this.scan().finally(() => (this.sweeping = undefined)));
    return (this.again ??= this.sweeping.then(() => {
      this.again = undefined;
      return this.sweep();
    }));
  }

  private async scan(): Promise<void> {
    const started = Date.now();
    const during = (this.shownDuring = new Set());
    const seen = new Map<string, Kept>();
    for (const name of await readdir(this.dir).catch(() => [] as string[])) {
      const path = `${this.dir}/${name}`;
      const s = await stat(path).catch(() => undefined);
      if (!s?.isFile()) continue;
      if (name.endsWith(PART)) {
        if (started - s.mtimeMs > STALE_PART_MS) await rm(path, { force: true }).catch(() => {});
      } else if (name.endsWith(".png")) seen.set(name, { bytes: s.size, at: s.mtimeMs });
    }
    this.shownDuring = undefined;
    // A drawing this server showed goes by when it showed it: an mtime, its own stamp or the
    // file's writing, is no finer than the moments between two shows.
    for (const [name, k] of seen) k.at = this.files.get(name)?.at ?? k.at;
    for (const name of during) {
      const k = this.files.get(name);
      if (k && !seen.has(name)) seen.set(name, k);
    }
    this.files = new Map([...seen].sort((a, b) => a[1].at - b[1].at));
    this.bytes = [...this.files.values()].reduce((n, k) => n + k.bytes, 0);
    await Promise.all(overflow([...this.files].map(([n, k]) => [n, k.bytes]), this.cap).map((name) => this.drop(name)));
  }

  /** `name` shown just now, `bytes` long; resolves once it is stamped and, over the cap, swept. */
  async use(name: string, bytes: number): Promise<void> {
    this.last = Math.max(Date.now(), this.last + 1e-3);
    this.bytes += bytes - (this.files.get(name)?.bytes ?? 0);
    this.files.delete(name);
    this.files.set(name, { bytes, at: this.last });
    this.shownDuring?.add(name);
    // Stamped, so another server, or this one started later, knows what was shown last.
    const now = new Date(this.last);
    await utimes(`${this.dir}/${name}`, now, now).catch(() => {});
    if (this.bytes > this.cap) await this.sweep();
  }

  /** Drops the drawings of `pdf` made before it changed to `mtime`; resolves once they are gone. */
  async forget(pdf: string, mtime: number): Promise<void> {
    await Promise.all(staleOf(this.files.keys(), pdf, mtime).map((name) => this.drop(name)));
  }

  /**
   * Makes the drawing `name` once, however many ask for it at once. `draw`
   * writes it to the path it is given, moved into place whole so no request
   * reads half a file, and draws nothing, returning false, when `wanted`
   * says every asker has gone. Resolves whether the drawing is there.
   */
  make(name: string, signal: AbortSignal, draw: (part: string, wanted: () => boolean) => Promise<boolean>): Promise<boolean> {
    const under = this.making.get(name);
    if (under) {
      under.askers.push(signal);
      return under.made;
    }
    const askers = [signal];
    const png = `${this.dir}/${name}`;
    const part = `${png}.${crypto.randomUUID()}${PART}`;
    const wanted = () => {
      if (askers.some((s) => !s.aborted)) return true;
      // Given up here, so one who asks next starts afresh instead of sharing a drawing never made.
      this.making.delete(name);
      return false;
    };
    const made = (async () => {
      try {
        // Made just before this was asked for.
        if (await Bun.file(png).exists()) return true;
        await mkdir(this.dir, { recursive: true });
        if (!(await draw(part, wanted))) return false;
        await rename(part, png);
        return true;
      } catch (e) {
        await rm(part, { force: true });
        throw e;
      } finally {
        if (this.making.get(name)?.askers === askers) this.making.delete(name);
      }
    })();
    this.making.set(name, { made, askers });
    return made;
  }

  private drop(name: string): Promise<void> {
    this.bytes -= this.files.get(name)?.bytes ?? 0;
    this.files.delete(name);
    return rm(`${this.dir}/${name}`, { force: true }).catch(() => {});
  }
}
