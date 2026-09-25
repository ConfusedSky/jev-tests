import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { matchItems, type Item } from "../palette";
import type { ShelfFile } from "../types";
import { basename, bytes, cx, dirname } from "../util";
import { Icon } from "./Icon";
import { MiddlePath } from "./Path";

type Props = { files: ShelfFile[]; pdf?: string; onPick: (path: string) => void; onShowShelf: () => void };

/** The shelf's PDFs as a searchable list, for asking one without the sidebar, which a narrow window hides. */
export function PdfPicker({ files, pdf, onPick, onShowShelf }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  // How far the list moves left so a narrow window does not cut off its right side.
  const [shift, setShift] = useState(0);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const items = useMemo(() => files.map<Item>((f) => ({ id: f.path, group: "", label: f.name, hint: f.path, run: () => {} })), [files]);
  const shown = useMemo(() => matchItems(items, query, 200), [items, query]);
  const cur = shown[Math.min(at, shown.length - 1)];

  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (refocus) button.current?.focus();
  };
  const pick = (path: string) => {
    close(false);
    onPick(path);
  };

  useLayoutEffect(() => {
    if (!open || !box.current) return setShift(0);
    // The edge that counts is the scrolling column's, inside its scrollbar, or the list scrolls it sideways.
    const column = box.current.closest("main");
    const edge = column ? column.getBoundingClientRect().left + column.clientWidth : document.documentElement.clientWidth;
    // Measured from the anchor and the layout width, which the list's opening animation does not scale.
    const right = box.current.parentElement!.getBoundingClientRect().left + box.current.offsetWidth;
    setShift(Math.max(0, right - (edge - 12)));
  }, [open]);

  // Focus goes in once the list stands where it will, and without scrolling the page sideways to reach it.
  useEffect(() => {
    if (open) box.current?.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => setAt(0), [query]);
  useEffect(() => {
    box.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cur?.id]);
  useEffect(() => {
    if (!open) return;
    // Escape closes the list and nothing else: the page's own Escape stops a paid run.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) close(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <span className="relative inline-flex min-w-0 max-w-full">
      <button
        ref={button}
        type="button"
        onClick={() => (open ? close(false) : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={pdf ?? "Pick the PDF to ask"}
        className={cx(
          "inline-flex min-w-0 max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 font-medium ring-1",
          pdf ? "text-teal-800 ring-teal-600/30 hover:bg-teal-50" : "bg-amber-50 text-amber-800 ring-amber-600/40 hover:bg-amber-100",
        )}
      >
        <span className="truncate">{pdf ? basename(pdf) : "Pick a PDF"}</span>
        <Icon name="down" size={12} />
      </button>
      {open && (
        <div
          ref={box}
          onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && e.relatedTarget !== button.current && close(false)}
          style={{ left: -shift }}
          className="absolute top-full z-30 mt-1 w-[min(28rem,calc(100vw-1.5rem))] animate-pop overflow-hidden rounded-xl border border-stone-200 bg-white text-sm shadow-xl"
        >
          {files.length === 0 ? (
            <div className="p-4 text-xs leading-relaxed text-stone-600">
              <div className="mb-1 text-sm font-medium text-stone-800">The shelf is empty</div>
              Add a folder or a locate command to it, and its PDFs are listed here.
              <button
                onClick={() => {
                  close(false);
                  onShowShelf();
                }}
                className="mt-2 block rounded-lg bg-stone-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-700"
              >
                Open the shelf
              </button>
            </div>
          ) : (
            <>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") setAt((a) => Math.min(shown.length - 1, a + 1));
                  else if (e.key === "ArrowUp") setAt((a) => Math.max(0, a - 1));
                  else if (e.key === "Enter" && cur) pick(cur.id);
                  else return;
                  e.preventDefault();
                }}
                placeholder={`Search ${files.length} PDF${files.length === 1 ? "" : "s"} by name or folder`}
                aria-label="Search the shelf's PDFs"
                role="combobox"
                aria-expanded="true"
                aria-controls={`${id}-list`}
                aria-activedescendant={cur ? `${id}-${shown.indexOf(cur)}` : undefined}
                className="w-full border-b border-stone-200 bg-transparent px-3 py-2 text-sm text-stone-900 placeholder:text-stone-500 focus:outline-none"
              />
              <ul id={`${id}-list`} role="listbox" aria-label="The shelf's PDFs" className="scroll-thin max-h-72 overflow-y-auto p-1">
                {shown.length === 0 && <li className="px-3 py-4 text-center text-xs text-stone-500">No PDF matches “{query}”</li>}
                {shown.map((it, i) => {
                  const f = byPath.get(it.id);
                  return (
                    <li
                      key={it.id}
                      id={`${id}-${i}`}
                      role="option"
                      aria-selected={it === cur}
                      // Pressing must not take focus from the search box, or the list closes before the click lands.
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseMove={() => setAt(i)}
                      onClick={() => pick(it.id)}
                      className={cx("flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5", it === cur && "bg-teal-50 ring-1 ring-teal-600/20", it.id === pdf && "font-medium text-teal-900")}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-stone-800">{it.label}</span>
                        <MiddlePath path={dirname(it.id)} className="text-[11px] text-stone-500" />
                      </span>
                      {f && <span className={cx("shrink-0 text-[11px] tabular-nums", f.size === 0 ? "font-medium text-amber-700" : "text-stone-500")}>{bytes(f.size)}</span>}
                    </li>
                  );
                })}
              </ul>
              {shown.length === 200 && <div className="border-t border-stone-100 px-3 py-1.5 text-[11px] text-stone-500">The first 200 shown; type to narrow them.</div>}
            </>
          )}
        </div>
      )}
    </span>
  );
}
