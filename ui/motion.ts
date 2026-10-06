import { useLayoutEffect, useState } from "react";

/** A CSS time as milliseconds: "220ms" and "0.22s" alike; nothing for what is no time. */
export function msOf(css: string): number {
  const n = parseFloat(css);
  if (!Number.isFinite(n)) return 0;
  return /ms\s*$/.test(css) ? n : n * 1000;
}

/** How long anything takes to go, as the stylesheet says (--leave); nothing with motion reduced, which plays no way out. */
export const leaveMs = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : msOf(getComputedStyle(document.documentElement).getPropertyValue("--leave")));

/** True while `open` and, once it is not, until its way out has played: what closes stays in the page that long. */
export function useLingering(open: boolean): boolean {
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  useLayoutEffect(() => {
    if (open) return;
    const timer = setTimeout(() => setShown(false), leaveMs());
    return () => clearTimeout(timer);
  }, [open]);
  return open || shown;
}

/**
 * The keys on their way out, and how to send more: they play their way out,
 * then `then` runs. A key already going is not sent again, and when all were
 * going nothing runs; with no keys at all, `then` runs at once. The timers
 * outlive the component, so what was asked for happens even if it is gone.
 */
export function useLeaving(): [ReadonlySet<string>, (keys: string[], then: () => void) => void] {
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const leave = (keys: string[], then: () => void) => {
    const going = keys.filter((k) => !leaving.has(k));
    if (going.length === 0) {
      if (keys.length === 0) then();
      return;
    }
    // Added and taken out, never replaced, so two close together do not cut each other's way out short.
    setLeaving((s) => new Set([...s, ...going]));
    setTimeout(() => {
      then();
      setLeaving((s) => new Set([...s].filter((k) => !going.includes(k))));
    }, leaveMs());
  };
  return [leaving, leave];
}
