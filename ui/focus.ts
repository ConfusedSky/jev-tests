/** Keeping keyboard focus inside what covers the page: a dialog, or the sidebar as a drawer. */
import { useEffect, type RefObject } from "react";

const CANDIDATES = "a[href], button, input, select, textarea, [tabindex]";

/** What Tab can reach inside `root`, in order: shown, enabled, not inert, not taken out of the order. */
export function tabbable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(CANDIDATES)].filter(
    (el) => el.tabIndex >= 0 && !el.matches(":disabled") && !el.closest("[inert]") && el.getClientRects().length > 0,
  );
}

/** Moves Tab's focus around inside `root` when it would leave it, from either end; true when it did. */
export function wrapTab(e: KeyboardEvent, root: HTMLElement): boolean {
  if (e.key !== "Tab" || e.defaultPrevented) return false;
  const all = tabbable(root);
  const [first, last] = [all[0], all[all.length - 1]];
  const at = document.activeElement;
  const inside = at instanceof Node && root.contains(at);
  if (first && last && inside && at !== (e.shiftKey ? first : last)) return false;
  e.preventDefault();
  (e.shiftKey ? last : first)?.focus();
  return true;
}

/** While `on`, Tab and Shift+Tab go round inside `ref` instead of leaving it. */
export function useTabTrap(ref: RefObject<HTMLElement | null>, on: boolean) {
  useEffect(() => {
    const root = ref.current;
    if (!on || !root) return;
    const onKey = (e: KeyboardEvent) => void wrapTab(e, root);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ref, on]);
}

/** While `on`, focus is inside `ref`, on the first thing Tab reaches unless it is there already; once off, it goes back where it was. */
export function useFocusInside(ref: RefObject<HTMLElement | null>, on: boolean) {
  useEffect(() => {
    const root = ref.current;
    if (!on || !root) return;
    const before = document.activeElement;
    if (!root.contains(before)) (tabbable(root)[0] ?? root).focus();
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, [ref, on]);
}
