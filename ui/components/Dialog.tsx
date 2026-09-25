import { useEffect, type ReactNode } from "react";
import { cx } from "../util";

/** A modal over the page: Escape or a click outside closes it, and focus goes back where it was. */
export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const before = document.activeElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (before instanceof HTMLElement) before.focus();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx("flex max-h-[80vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-stone-200", wide ? "max-w-2xl" : "max-w-lg")}>
        {children}
      </div>
    </div>
  );
}
