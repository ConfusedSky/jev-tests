import type { ReactNode } from "react";

/** What a click opens, growing to its height as it comes. */
export function Unfold({ children }: { children: ReactNode }) {
  return (
    <div className="grid animate-unfold grid-cols-[minmax(0,1fr)] grid-rows-[1fr]">
      <div className="min-h-0 min-w-0">{children}</div>
    </div>
  );
}
