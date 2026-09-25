import { useCallback, useEffect, useState } from "react";

export const basename = (p: string) => p.split("/").pop() ?? p;
export const dirname = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";

/** To the hundred-thousandth of a dollar under $1, as the tools' log prints it, so the two agree. */
export const dollars = (d: number) => (d === 0 ? "$0" : `$${d.toFixed(d < 1 ? 5 : 2)}`);
export const tokens = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString("en-US"));
export const secs = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : ms < 120_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);
/** A file's size; a file under a kilobyte that holds anything is "1 kB", so only a truly empty one says so. */
export const bytes = (n: number) => (n === 0 ? "empty" : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);

/** The key shortcuts are held with on `platform`: ⌘ on Apple's systems, Ctrl elsewhere. */
export const modKey = (platform: string) => (/Mac|iPhone|iPad|iPod/.test(platform) ? "⌘" : "Ctrl");
export const MOD = modKey(typeof navigator === "undefined" ? "" : navigator.platform || navigator.userAgent);

export function ago(at: number, now = Date.now()): string {
  const s = Math.round((now - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(at).toLocaleDateString();
}

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

/** `key`'s value in localStorage, or `initial` when there is none or it cannot be read. */
export function readStored<T>(key: string, initial: T, text = localStorage.getItem(key)): T {
  try {
    if (text === null) return initial;
    const saved = JSON.parse(text) as T;
    // An object saved before a field was added takes that field's default.
    const plain = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);
    return plain(initial) && plain(saved) ? { ...initial, ...saved } : saved;
  } catch {
    return initial;
  }
}

/** Writes `value` under `key` at once, for when there is no render left to do it, as the page unloads. */
export function writeStored<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full store keeps what it had.
  }
}

/**
 * State kept in localStorage under `key`, read once and written on every
 * change. Shared, it follows other tabs' writes, and an update builds on
 * the stored value rather than this tab's copy, so two tabs adding a run
 * each keep both.
 */
export function useStored<T>(key: string, initial: T, shared = false): [T, (v: T | ((old: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readStored(key, initial));
  // A full store keeps the value for this session only.
  useEffect(() => writeStored(key, value), [key, value]);
  useEffect(() => {
    if (!shared) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setValue(readStored(key, initial, e.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // `initial` is only a fallback for a removed key; a new object each render must not re-subscribe.
  }, [key, shared]);
  const set = useCallback(
    (v: T | ((old: T) => T)) =>
      setValue((old) => {
        const base = shared ? readStored(key, old) : old;
        return typeof v === "function" ? (v as (old: T) => T)(base) : v;
      }),
    [key, shared],
  );
  return [value, set];
}

/** Re-renders every `ms` while `on`, for clocks that tick. */
export function useTick(on: boolean, ms = 250): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [on, ms]);
  return now;
}

export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Offers `text` as a file to save. */
export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Whether a media query holds, kept current. */
export function useMediaQuery(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setOn(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return on;
}
