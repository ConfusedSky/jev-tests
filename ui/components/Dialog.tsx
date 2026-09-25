import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { tabbable, wrapTab } from "../focus";
import { cx } from "../util";

/**
 * A modal over the page: the page behind is inert and Tab goes round inside
 * it; Escape or a click outside closes it, and focus goes back where it was.
 */
export function Dialog({ title, onClose, children, size = "md" }: { title: string; onClose: () => void; children: ReactNode; size?: "md" | "wide" | "page" | "full" }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // Taken while rendering, before a field inside takes focus on mount.
  const [opener] = useState(() => document.activeElement);
  useEffect(() => {
    const root = panel.current!;
    // A dialog that took another's place in one render got the other's field; by now focus is back where that one came from.
    const before = opener?.isConnected ? opener : document.activeElement;
    // The dialog is portalled beside #root, so all of the page can be made inert at once.
    const page = document.getElementById("root");
    page?.setAttribute("inert", "");
    if (!root.contains(document.activeElement)) (tabbable(root)[0] ?? root).focus();
    const onKey = (e: KeyboardEvent) => {
      // A layer open inside, such as the viewer's list over its pages, closes on Escape first.
      if (e.key === "Escape" && root.querySelector("[data-closes-on-escape]")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      } else wrapTab(e, root);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      page?.removeAttribute("inert");
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);
  return createPortal(
    <div className={cx("fixed inset-0 z-40 flex animate-fade items-start justify-center bg-black/40", size === "full" ? "" : size === "page" ? "p-4 pt-[3vh]" : "p-4 pt-[10vh]")} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx(
          "flex w-full animate-pop flex-col overflow-hidden bg-white shadow-2xl ring-1 ring-stone-200 focus:outline-none",
          size === "full" ? "h-full rounded-none" : "rounded-2xl",
          { md: "max-h-[80vh] max-w-lg", wide: "max-h-[80vh] max-w-2xl", page: "max-h-[94vh] max-w-4xl", full: "" }[size],
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
