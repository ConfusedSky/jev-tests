import { useEffect, useState } from "react";

export const basename = (p: string) => p.split("/").pop() ?? p;
export const dirname = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";

/** To the hundred-thousandth of a dollar under $1, as the tools' log prints it, so the two agree. */
export const dollars = (d: number) => (d === 0 ? "$0" : `$${d.toFixed(d < 1 ? 5 : 2)}`);
export const tokens = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString("en-US"));
export const secs = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : ms < 120_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);
export const bytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);

export function ago(at: number, now = Date.now()): string {
  const s = Math.round((now - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(at).toLocaleDateString();
}

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

/** State kept in localStorage under `key`, read once and written on every change. */
export function useStored<T>(key: string, initial: T): [T, (v: T | ((old: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      if (s === null) return initial;
      const saved = JSON.parse(s) as T;
      // An object saved before a field was added takes that field's default.
      const plain = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);
      return plain(initial) && plain(saved) ? { ...initial, ...saved } : saved;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // A full store keeps the value for this session only.
    }
  }, [key, value]);
  return [value, setValue];
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
