import type { RefObject } from "react";
import { splitAt } from "../viewer";

const [MIN, MAX] = [0.3, 0.7];

/** The bar between the answer and the pages: dragged, or moved with the arrow keys, it sets the pages' share of `box`. */
export function SplitHandle({ box, ratio, onRatio }: { box: RefObject<HTMLElement | null>; ratio: number; onRatio: (r: number) => void }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Width of the pages beside the answer"
      aria-valuemin={MIN * 100}
      aria-valuemax={MAX * 100}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      onPointerDown={(e) => {
        // Dragging must not start a text selection across the answer.
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const r = box.current?.getBoundingClientRect();
        if (r && e.currentTarget.hasPointerCapture(e.pointerId)) onRatio(splitAt(e.clientX, r.left, r.width, MIN, MAX));
      }}
      onKeyDown={(e) => {
        const by = { ArrowLeft: 0.05, ArrowRight: -0.05 }[e.key];
        if (by === undefined) return;
        e.preventDefault();
        onRatio(Math.max(MIN, Math.min(MAX, ratio + by)));
      }}
      className="group relative w-1.5 shrink-0 cursor-col-resize touch-none bg-stone-200 hover:bg-teal-600/40 focus-visible:bg-teal-600/50 focus-visible:outline-none"
    >
      <span aria-hidden="true" className="absolute top-1/2 left-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-stone-400 group-hover:bg-teal-700" />
    </div>
  );
}
