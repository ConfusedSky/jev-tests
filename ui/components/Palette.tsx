import { useEffect, useMemo, useRef, useState } from "react";
import { matchItems, type Item } from "../palette";
import { cx } from "../util";
import { Dialog } from "./Dialog";
import { MiddlePath } from "./Path";

/** Every action, PDF, past run and recent question, a few keystrokes away. */
export function Palette({ items, onClose }: { items: Item[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  // Why the item just picked cannot run, said in place of running it.
  const [why, setWhy] = useState<string>();
  const list = useRef<HTMLUListElement>(null);
  // Matches stay grouped, each group in the order the matches came.
  const shown = useMemo(() => {
    const m = matchItems(items, query);
    return [...new Set(m.map((i) => i.group))].flatMap((g) => m.filter((i) => i.group === g));
  }, [items, query]);
  const cur = shown[Math.min(at, shown.length - 1)];

  useEffect(() => setAt(0), [query]);
  // The items are made afresh on every render of the page, so a row is followed by its id.
  useEffect(() => setWhy(undefined), [cur?.id]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cur?.id]);

  const pick = (it: Item) => {
    if (it.disabled) {
      setWhy(`${it.label}: ${it.disabled}`);
      return;
    }
    onClose();
    it.run();
  };

  return (
    <Dialog title="Command palette" onClose={onClose}>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setAt((a) => Math.min(shown.length - 1, a + 1));
          else if (e.key === "ArrowUp") setAt((a) => Math.max(0, a - 1));
          else if (e.key === "Enter" && cur) pick(cur);
          else return;
          e.preventDefault();
        }}
        placeholder="Type a command, a PDF, or a past question…"
        aria-label="Search commands"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={cur ? `palette-${shown.indexOf(cur)}` : undefined}
        aria-describedby="palette-why"
        className="border-b border-stone-200 bg-transparent px-4 py-3 text-base text-stone-900 placeholder:text-stone-500 focus:outline-none"
      />
      <ul ref={list} id="palette-list" role="listbox" className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">
        {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-stone-500">Nothing matches “{query}”</li>}
        {shown.map((it, i) => (
          <li key={it.id} className="contents">
            {(i === 0 || shown[i - 1]!.group !== it.group) && <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500">{it.group}</div>}
            <button
              // By position: an item's own id can hold a path's spaces, which an id reference cannot.
              id={`palette-${i}`}
              role="option"
              aria-selected={it === cur}
              aria-disabled={!!it.disabled}
              // The list is walked with the arrow keys from the search box; Tab leaves it for the next control.
              tabIndex={-1}
              // A pointer resting where the palette opens is not a choice; only moving it is.
              onMouseMove={() => setAt(i)}
              onClick={() => pick(it)}
              className={cx(
                "flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-sm",
                it === cur ? "bg-teal-50 text-teal-900 ring-1 ring-teal-600/20" : "text-stone-800",
                it.disabled && "text-stone-500",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.disabled ? (
                <span className="min-w-0 max-w-[45%] truncate text-xs text-amber-700">{it.disabled}</span>
              ) : it.path ? (
                <MiddlePath path={it.path} className="max-w-[50%] text-xs text-stone-500" />
              ) : (
                it.hint && <span className="min-w-0 max-w-[45%] truncate text-xs text-stone-500">{it.hint}</span>
              )}
              {it.shortcut && <kbd className="rounded bg-stone-100 px-1.5 font-mono text-[10px] text-stone-500">{it.shortcut}</kbd>}
            </button>
          </li>
        ))}
      </ul>
      <div id="palette-why" role="status" className={cx("border-t border-stone-100 px-4 py-2 text-xs", why ? "bg-amber-50 font-medium text-amber-900" : "sr-only")}>
        {why}
      </div>
      <div className="flex gap-4 border-t border-stone-100 px-4 py-2 text-[11px] text-stone-500">
        <span>↑↓ move</span>
        <span>⏎ run</span>
        <span>esc close</span>
      </div>
    </Dialog>
  );
}
