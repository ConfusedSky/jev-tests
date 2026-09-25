import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { cx } from "../util";

type Toast = { id: number; text: string; tone: "ok" | "warn" };
type Show = (text: string, tone?: Toast["tone"]) => void;

const Ctx = createContext<Show>(() => {});

/** A line of passing feedback at the foot of the page: copied, saved, removed. */
export const useToast = () => useContext(Ctx);

export function Toasts({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const next = useRef(0);
  const show = useCallback<Show>((text, tone = "ok") => {
    const id = next.current++;
    setList((l) => [...l, { id, text, tone }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 2500);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex flex-col items-center gap-2 px-4">
        {list.map((t) => (
          <div key={t.id} role="status" className={cx("max-w-md rounded-lg px-3 py-1.5 text-sm shadow-lg ring-1", t.tone === "ok" ? "bg-stone-800 text-white ring-stone-700" : "bg-amber-50 text-amber-900 ring-amber-600/30")}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
