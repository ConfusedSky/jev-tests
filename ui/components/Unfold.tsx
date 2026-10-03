import type { ReactNode } from "react";
import { useLingering } from "../motion";
import { cx } from "../util";

/** What a click opens, growing to its height as it comes and folding away as it goes. `children` is called only while it is in the page. */
export function Unfold({ open, children }: { open: boolean; children: () => ReactNode }) {
  if (!useLingering(open)) return null;
  return (
    <div inert={!open} className={cx("grid grid-cols-[minmax(0,1fr)] grid-rows-[1fr]", open ? "animate-unfold" : "animate-fold")}>
      <div className="min-h-0 min-w-0">{children()}</div>
    </div>
  );
}
