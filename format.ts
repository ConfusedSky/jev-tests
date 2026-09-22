import type { Ranked } from "./shared";

export function elideMiddle(s: string, w: number): string {
  if (s.length <= w) return s;
  const keep = w - 1;
  const head = Math.ceil(keep / 2);
  return s.slice(0, head) + "\u2026" + s.slice(s.length - (keep - head));
}

// The filename is what distinguishes siblings, so only the directories shrink.
export function elidePath(s: string, w: number): string {
  if (s.length <= w) return s;
  const cut = s.lastIndexOf("/");
  if (cut < 0) return elideMiddle(s, w);
  const base = s.slice(cut + 1);
  const avail = w - base.length - 1;
  if (avail < 3) return elideMiddle(base, w);
  return `${elideMiddle(s.slice(0, cut), avail)}/${base}`;
}

// Keep the tab-separated form when piped; align only for a human at a TTY.
export function render(rows: Ranked[], cols?: number): string[] {
  if (cols === undefined && !process.stdout.isTTY)
    return rows.map((r) => `${r.score.toFixed(2)}\t${r.name}\t${r.reason}`);
  cols ??= process.stdout.columns ?? 120;
  const reasonW = Math.max(...rows.map((r) => r.reason.length));
  const nameW = Math.max(
    24,
    Math.min(Math.max(...rows.map((r) => r.name.length)), cols - 4 - 2 - reasonW - 2),
  );
  return rows.map(
    (r) =>
      `${r.score.toFixed(2).padStart(4)}  ${elidePath(r.name, nameW).padEnd(nameW)}  ${r.reason}`,
  );
}

