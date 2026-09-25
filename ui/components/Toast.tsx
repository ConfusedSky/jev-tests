import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cx, MOD } from "../util";

type Action = { label: string; run: () => void };
type Toast = { id: number; text: string; tone: "ok" | "warn"; action?: Action };
type Show = (text: string, tone?: Toast["tone"], action?: Action) => void;

const Ctx = createContext<Show>(() => {});

/** A line of passing feedback at the foot of the page: copied, saved, removed; one that offers to undo stays longer. */
export const useToast = () => useContext(Ctx);

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);

export function Toasts({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const next = useRef(0);
  const show = useCallback<Show>((text, tone = "ok", action) => {
    const id = next.current++;
    setList((l) => [...l, { id, text, tone, action }]);
  }, []);
  const drop = useCallback((id: number) => setList((l) => l.filter((t) => t.id !== id)), []);
  const act = (t: Toast) => {
    drop(t.id);
    t.action?.run();
  };

  // The newest undo is a keystroke away, outside a text field, whose own undo it would steal.
  const undoable = useRef<Toast>(undefined);
  undoable.current = list.findLast((t) => t.action);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = undoable.current;
      if (!t || e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== "z" || typing(e.target)) return;
      e.preventDefault();
      drop(t.id);
      t.action?.run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drop]);

  return (
    <Ctx.Provider value={show}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex flex-col items-center gap-2 px-4">
        {list.map((t) => (
          <Item key={t.id} toast={t} onGone={() => drop(t.id)} onAct={() => act(t)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function Item({ toast: t, onGone, onAct }: { toast: Toast; onGone: () => void; onAct: () => void }) {
  // Held while the pointer or focus is on it, so an Undo being reached for does not vanish.
  const [held, setHeld] = useState(false);
  const [going, setGoing] = useState(false);
  useEffect(() => {
    if (held || going) return;
    const timer = setTimeout(() => setGoing(true), t.action ? 8000 : 2500);
    return () => clearTimeout(timer);
  }, [held, going]);
  // Gone once its way out has played; a timer, since with motion reduced no animation ends.
  useEffect(() => {
    if (!going) return;
    const timer = setTimeout(onGone, 150);
    return () => clearTimeout(timer);
  }, [going]);
  return (
    <div
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className={cx(
        "flex max-w-md items-center gap-3 rounded-lg px-3 py-1.5 text-sm shadow-lg ring-1",
        going ? "animate-sink" : "animate-rise",
        t.action && "pointer-events-auto",
        t.tone === "ok" ? "bg-stone-800 text-white ring-stone-700" : "bg-amber-50 text-amber-900 ring-amber-600/30",
      )}
    >
      <span className="min-w-0 [overflow-wrap:anywhere]">{t.text}</span>
      {t.action && (
        <button onClick={onAct} title={`${t.action.label} (${MOD}+Z)`} className="shrink-0 rounded-md px-2 py-0.5 text-sm font-semibold text-teal-200 ring-1 ring-white/20 hover:bg-white/10">
          {t.action.label}
          <kbd className="ml-1.5 hidden font-sans text-[10px] font-normal text-stone-300 md:inline">{MOD} Z</kbd>
        </button>
      )}
    </div>
  );
}
