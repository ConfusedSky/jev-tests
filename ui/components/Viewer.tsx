import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Mark, PageSize } from "../types";
import { basename, cx, isTyping, plural } from "../util";
import { anchorAt, layOut, markAnchor, pageAt, pageInput, renderWidth, scrollFor, scrollOf, stepSpot, zoomStep, type Anchor, type Spot, type ViewBox } from "../viewer";
import { Icon } from "./Icon";
import { docProblem, MarkLayer, pageSrc, PageImage, sizeOf, useDoc, type Served } from "./Page";

/** Room around the column of pages, and between pages, in CSS pixels. */
const PAD = 16;
const GAP = 12;
/** Below this width the list of highlights folds into a button, leaving the pages the room. */
const LIST_ROOM = 720;

type Props = {
  spots: Spot[];
  at: number;
  /** Changes with every ask to show a highlight, the one shown included, which scrolls back to it. */
  seq: number;
  onAt: (i: number) => void;
  served: Served;
  /** Closes the viewer: the dialog it is in, or the pane beside the answer. */
  onClose: () => void;
  closeLabel: string;
  /** Takes the cursor into the pages as it opens, so the arrow keys and Page Down scroll them. */
  autoFocus?: boolean;
};

const tail = (section: string) => section.split(" > ").pop() ?? section;

/**
 * A run's highlighted pages in the document itself: every page of the PDF
 * in a column, drawn by the server only as it nears the view, the run's
 * marks laid over them, and a list of the highlights to go between.
 */
export function Viewer({ spots, at: wanted, seq, onAt, served, onClose, closeLabel, autoFocus }: Props) {
  const at = Math.max(0, Math.min(wanted, spots.length - 1));
  const spot = spots[at]!;
  const pdf = spot.pdf;
  const doc = useDoc(pdf, served);
  const pages = useMemo(() => doc.info?.pages ?? [], [doc.info]);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const nav = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState({ width: 0, height: 0, root: 0 });
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(spot.page);
  const [typed, setTyped] = useState<string>();
  const [listOpen, setListOpen] = useState(false);
  const [opening, setOpening] = useState<string>();
  const [near, setNear] = useState<ReadonlySet<number>>(new Set());
  const compact = view.root > 0 && view.root < LIST_ROOM;
  const width = Math.max(120, Math.round((view.width - 2 * PAD) * zoom));
  const lay = useMemo(() => layOut(pages, width, GAP), [pages, width]);
  const drawn = renderWidth(width, window.devicePixelRatio || 1);
  const name = basename(pdf);

  // What the view holds on to while the pages change size (see Anchor): the
  // highlight shown while its page is in view, so neither a zoom nor the pane
  // settling its width as it opens moves it out of sight; else the point
  // `vy` down the view, across its middle.
  const anchor = useRef<Anchor>(undefined);
  const laid = useRef({ lay, width, pad: PAD });
  laid.current = { lay, width, pad: PAD };
  const shown = useRef({ spot, info: doc.info });
  shown.current = { spot, info: doc.info };
  const viewBox = (el: HTMLElement): ViewBox => ({ left: el.scrollLeft, top: el.scrollTop, width: el.clientWidth, height: el.clientHeight });
  const hold = (vy: number) => {
    const el = scroller.current;
    if (!el || laid.current.lay.tops.length === 0) return;
    const { spot, info } = shown.current;
    const size = spot.size ?? sizeOf(info, spot.page);
    anchor.current = (size && markAnchor(spot, size, laid.current, viewBox(el))) || anchorAt(laid.current, viewBox(el), 0.5, vy);
  };

  // Before the dialog around it, if any, puts the cursor on its first button.
  useLayoutEffect(() => {
    if (autoFocus) scroller.current?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    const [el, box] = [scroller.current, root.current];
    if (!el || !box) return;
    const measure = () => {
      hold(0);
      setView({ width: el.clientWidth, height: el.clientHeight, root: box.clientWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // Only pages within a view's height of the view are drawn.
  useEffect(() => {
    const el = scroller.current;
    setNear((old) => (old.size ? new Set() : old));
    if (!el || pages.length === 0) return;
    const io = new IntersectionObserver(
      (entries) =>
        setNear((old) => {
          const next = new Set(old);
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) next.add(n);
            else next.delete(n);
          }
          return next;
        }),
      { root: el, rootMargin: "100% 0px" },
    );
    for (const p of el.querySelectorAll("[data-page]")) io.observe(p);
    return () => io.disconnect();
  }, [pdf, pages]);

  // A new highlight, or its document's pages arriving, scrolls to it once the pages are laid out.
  const jump = useRef<number | undefined>(at);
  useLayoutEffect(() => {
    jump.current = at;
  }, [at, seq]);
  useLayoutEffect(() => {
    const el = scroller.current;
    const target = jump.current === undefined ? undefined : spots[jump.current];
    if (el && anchor.current && lay.tops.length) {
      const to = scrollOf(anchor.current, laid.current, el.clientWidth, el.clientHeight);
      anchor.current = undefined;
      el.scrollTop = to.top;
      el.scrollLeft = to.left;
    }
    if (!el || !target || target.pdf !== pdf || view.width === 0 || target.page > lay.tops.length) return;
    jump.current = undefined;
    const i = target.page - 1;
    const size = target.size ?? sizeOf(doc.info, target.page)!;
    el.scrollTop = PAD + scrollFor(target, lay.tops[i]!, lay.heights[i]!, size, el.clientHeight);
    const left = Math.min(...target.marks.map((m) => m.x0));
    el.scrollLeft = Number.isFinite(left) ? Math.max(0, (left / size.width) * width + PAD - 24) : 0;
    setPage(target.page);
  }, [at, seq, lay, pdf, view.width]);

  const moved = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(moved.current);
    moved.current = requestAnimationFrame(() => {
      const el = scroller.current;
      if (el && lay.tops.length) setPage(pageAt(lay.tops, el.scrollTop - PAD + el.clientHeight / 3));
    });
  };

  const go = (by: 1 | -1) => onAt(stepSpot(spots.length, at, by));
  const zoomTo = (z: number) => {
    if (z === zoom) return;
    hold(0.5);
    setZoom(z);
  };
  const toPage = (n: number) => {
    const el = scroller.current;
    if (!el || !Number.isFinite(n) || lay.tops.length === 0) return;
    const p = Math.max(1, Math.min(lay.tops.length, Math.round(n)));
    el.scrollTop = PAD + lay.tops[p - 1]! - 8;
    setPage(p);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    if (e.key === "n") go(1);
    else if (e.key === "p") go(-1);
    else if (e.key === "+" || e.key === "=") zoomTo(zoomStep(zoom, 1));
    else if (e.key === "-") zoomTo(zoomStep(zoom, -1));
    else if (e.key === "0") zoomTo(1);
    else return;
    e.preventDefault();
  };

  /** Arrow keys walk the list, one Tab stop for all of it, showing each highlight as they go. */
  const listKeys = (e: KeyboardEvent<HTMLOListElement>) => {
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: spots.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const i = Math.max(0, Math.min(spots.length - 1, to));
    onAt(i);
    list.current?.querySelectorAll<HTMLButtonElement>("button")[i]?.focus();
  };

  // Each page's marks, the highlight shown drawn over the rest.
  const marksOn = useMemo(() => {
    const m = new Map<number, { marks: Mark[]; size: PageSize; now: boolean }[]>();
    spots.forEach((s, i) => {
      const size = s.size ?? sizeOf(doc.info, s.page);
      if (s.pdf !== pdf || s.marks.length === 0 || !size) return;
      m.set(s.page, [...(m.get(s.page) ?? []), { marks: s.marks, size, now: i === at }].sort((a, b) => Number(a.now) - Number(b.now)));
    });
    return m;
  }, [spots, pdf, at, doc.info]);

  const inPdf = spots.filter((s) => s.pdf === pdf).flatMap((s) => s.marks);
  const openInViewer = async () => {
    setOpening(inPdf.length ? "marking a copy…" : "opening…");
    try {
      const r = await fetch("/api/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: pdf, page, marks: inPdf }) });
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      setOpening(r.ok ? undefined : (body.error ?? `failed (${r.status})`));
    } catch {
      setOpening("the UI server is not running");
    }
  };

  const button = "flex h-8 min-w-7 items-center justify-center rounded-lg px-1 text-stone-600 hover:bg-stone-100 hover:text-stone-900 disabled:opacity-40 disabled:hover:bg-transparent";
  const floating = compact && listOpen;
  const showList = !compact || listOpen;

  // The list folded over the pages takes the cursor as it opens, and goes on
  // Escape, which closes nothing else, on a press outside it, or once the
  // cursor leaves it; the dialog around it leaves it Escape (see Dialog).
  useEffect(() => {
    if (!floating) {
      if (!compact) setListOpen(false);
      return;
    }
    list.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
    const mine = (t: EventTarget | null) => t instanceof Node && !!(nav.current?.contains(t) || toggle.current?.contains(t));
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (nav.current?.contains(document.activeElement)) toggle.current?.focus();
      setListOpen(false);
    };
    const away = (e: Event) => {
      if (!mine(e.target)) setListOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", away);
    document.addEventListener("pointerdown", away, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", away);
      document.removeEventListener("pointerdown", away, true);
    };
  }, [floating, compact]);

  return (
    <div ref={root} onKeyDown={onKey} role="region" aria-label={`Pages of ${name}`} className="flex h-full min-h-0 flex-col bg-stone-50">
      <div className="flex flex-wrap items-center gap-x-0.5 gap-y-1 border-b border-stone-200 bg-white px-1.5 py-1.5">
        {compact && (
          <button ref={toggle} onClick={() => setListOpen((o) => !o)} aria-expanded={listOpen} aria-controls="viewer-list" title="The run's highlights" className={cx(button, "gap-1 text-xs font-medium", listOpen && "bg-teal-50 text-teal-900")}>
            <Icon name="list" size={16} />
            {spots.length}
          </button>
        )}
        <div className="flex items-center">
          <button onClick={() => go(-1)} disabled={at === 0} aria-label="Previous highlight" title="Previous highlight (p)" className={button}>
            <Icon name="chevron" size={14} className="rotate-180" />
          </button>
          <span aria-live="polite" className="px-0.5 text-xs whitespace-nowrap text-stone-700 tabular-nums">
            highlight {at + 1} of {spots.length}
          </span>
          <button onClick={() => go(1)} disabled={at === spots.length - 1} aria-label="Next highlight" title="Next highlight (n)" className={button}>
            <Icon name="chevron" size={14} />
          </button>
        </div>
        <label className="flex items-center gap-1 text-xs whitespace-nowrap text-stone-500">
          p.
          <input
            value={typed ?? String(page)}
            onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => setTyped(undefined)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const n = pageInput(typed, pages.length);
              if (n !== undefined) toPage(n);
              setTyped(undefined);
            }}
            inputMode="numeric"
            aria-label={`Go to page, of ${pages.length}`}
            disabled={pages.length === 0}
            className="w-10 rounded-md border border-stone-200 bg-white px-1 py-0.5 text-center font-mono text-xs text-stone-800 tabular-nums focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
          />
          <span className="tabular-nums">of {pages.length || "…"}</span>
        </label>
        <div className="ml-auto flex items-center">
          <button onClick={() => zoomTo(zoomStep(zoom, -1))} disabled={zoom <= 0.5} aria-label="Zoom out" title="Zoom out (−)" className={button}>
            <Icon name="minus" size={14} />
          </button>
          <button onClick={() => zoomTo(1)} title="Fit the width (0)" className={cx(button, "w-10 text-xs tabular-nums")}>
            {zoom === 1 ? "fit" : `${Math.round(zoom * 100)}%`}
          </button>
          <button onClick={() => zoomTo(zoomStep(zoom, 1))} disabled={zoom >= 3} aria-label="Zoom in" title="Zoom in (+)" className={button}>
            <Icon name="plus" size={14} />
          </button>
        </div>
        <div className={cx("flex items-center", !compact && "border-l border-stone-200 pl-1")}>
          <button onClick={openInViewer} title={inPdf.length ? "Open this page in your desktop PDF viewer, in a copy marked with this run's highlights" : "Open this page in your desktop PDF viewer"} className={cx(button, "gap-1 text-xs font-medium")}>
            <Icon name="window" size={14} />
            {!compact && <span>in viewer</span>}
          </button>
          <a href={`/api/pdf?path=${encodeURIComponent(pdf)}#page=${page}`} target="_blank" rel="noreferrer" title="Open the PDF itself, unmarked, at this page in a new tab" className={cx(button, "gap-1 text-xs font-medium")}>
            <Icon name="external" size={14} />
            {!compact && <span>PDF</span>}
          </a>
          <button onClick={onClose} aria-label={closeLabel} title={closeLabel} className={button}>
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 border-b border-stone-200 bg-white px-3 py-1 text-[11px] text-stone-500">
        <span className="min-w-0 truncate">
          <span className="font-medium text-stone-700" title={pdf}>
            {name}
          </span>
          {spot.cell && <span> · {spot.cell}</span>}
          {!/^p\.\d+(-\d+)?$/.test(spot.section) && <span title={spot.section}> · {tail(spot.section)}</span>}
        </span>
        <span className={cx("ml-auto text-right", spot.marks.length === 0 && "text-amber-700")}>{spot.marks.length ? `p.${spot.page}, ${plural(spot.marks.length, "mark")}` : `p.${spot.page}: ${spot.unmarked}`}</span>
      </div>
      {opening && (
        <div role="status" className={cx("border-b border-stone-200 px-3 py-1 text-xs", opening.endsWith("…") ? "bg-white text-stone-500" : "bg-rose-50 text-rose-800")}>
          {opening}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {showList && (
          <nav ref={nav} id="viewer-list" aria-label="The run's highlights" data-closes-on-escape={floating || undefined} className={cx("scroll-thin flex w-60 shrink-0 flex-col overflow-y-auto border-r border-stone-200 bg-stone-50", compact && "absolute inset-y-0 left-0 z-10 shadow-xl")}>
            <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
              {plural(spots.length, "highlight")}
              <span className="sr-only">; the arrow keys move between them</span>
            </div>
            <ol ref={list} onKeyDown={listKeys} className="space-y-0.5 px-1.5 pb-2">
              {spots.map((s, i) => (
                <li key={i}>
                  <button
                    tabIndex={i === at ? 0 : -1}
                    aria-current={i === at ? "true" : undefined}
                    onClick={() => {
                      onAt(i);
                      if (compact) setListOpen(false);
                    }}
                    className={cx("w-full rounded-lg px-2 py-1.5 text-left text-xs", i === at ? "bg-white shadow-sm ring-1 ring-teal-600/30" : "hover:bg-stone-100")}
                  >
                    {s.cell && <span className="block truncate font-semibold text-stone-800">{s.cell}</span>}
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium text-stone-700" title={s.pdf}>
                        {basename(s.pdf)}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-stone-600">p.{s.page}</span>
                    </span>
                    {!/^p\.\d+(-\d+)?$/.test(s.section) && <span className="block truncate text-stone-500">{tail(s.section)}</span>}
                    {s.snippet && <span className="mt-0.5 line-clamp-2 font-serif text-[12px] leading-snug text-stone-700">{s.snippet}</span>}
                    <span className={cx("mt-0.5 block text-[11px]", s.marks.length ? "text-amber-800" : "text-stone-500")}>{s.marks.length ? plural(s.marks.length, "mark") : "not marked"}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div id="viewer-pages" ref={scroller} onScroll={onScroll} tabIndex={0} aria-label={`The pages of ${name}; scroll to read on`} className="scroll-thin relative min-h-0 min-w-0 flex-1 overflow-auto bg-stone-200/70 focus-visible:outline-offset-[-2px]">
          {pages.length === 0 && (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-stone-500">
              {doc.error ? docProblem(doc.error) : served.pending ? "Listing the shelf…" : "Loading the pages…"}
            </div>
          )}
          {pages.length > 0 && (
            <div className="relative" style={{ width: width + 2 * PAD, minWidth: "100%", height: lay.total + 2 * PAD }}>
              {doc.error && <div className="sticky top-2 z-10 mx-auto w-fit max-w-[90%] rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900 shadow ring-1 ring-amber-600/30">{docProblem(doc.error)}</div>}
              <Column pdf={pdf} name={name} lay={lay} width={width} drawn={drawn} near={near} marksOn={marksOn} src={(n, w) => pageSrc(pdf, n, w, doc)} srcKey={`${doc.boot}:${doc.info?.mtime}`} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type ColumnProps = {
  pdf: string;
  name: string;
  lay: ReturnType<typeof layOut>;
  width: number;
  drawn: number;
  near: ReadonlySet<number>;
  marksOn: Map<number, { marks: Mark[]; size: PageSize; now: boolean }[]>;
  src: (page: number, w: number) => string;
  /** What `src` depends on besides its arguments, for the column to know when it has changed. */
  srcKey: string;
};

/** Every page as a box of its own shape, drawn only when near the view; kept apart so scrolling, which moves the page count, does not redo hundreds of them. */
const Column = memo(
  function Column({ name, lay, width, drawn, near, marksOn, src }: ColumnProps) {
    return (
      <>
        {lay.tops.map((top, i) => {
          const n = i + 1;
          const marks = marksOn.get(n);
          return (
            <div key={n} data-page={n} className="absolute overflow-hidden bg-white shadow-sm ring-1 ring-stone-300/70" style={{ top: PAD + top, left: `max(${PAD}px, calc(50% - ${width / 2}px))`, width, height: lay.heights[i] }}>
              {near.has(n) ? (
                <>
                  <PageImage src={src(n, drawn)} alt={`Page ${n} of ${name}${marks ? `, ${plural(marks.reduce((k, g) => k + g.marks.length, 0), "mark")}` : ""}`} />
                  {marks && <MarkLayer groups={marks} />}
                </>
              ) : (
                <span className="absolute inset-0 flex items-center justify-center font-mono text-xs text-stone-400">{n}</span>
              )}
            </div>
          );
        })}
      </>
    );
  },
  (a, b) => a.pdf === b.pdf && a.lay === b.lay && a.width === b.width && a.drawn === b.drawn && a.near === b.near && a.marksOn === b.marksOn && a.srcKey === b.srcKey,
);
