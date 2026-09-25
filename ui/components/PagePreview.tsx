import { useRef, useState } from "react";
import { markRows } from "../mark";
import { basename, cx } from "../util";
import { Dialog } from "./Dialog";
import { Action, Actions, Icon } from "./Icon";

export const pdfUrl = (path: string, page: number) => `/api/pdf?path=${encodeURIComponent(path)}#page=${page}`;

/** The page as rendered by mutool, the answer's highlight on it, and the ways to open it. */
export function PagePreview({ view, pdf, page, stamp, compact }: { view: string; pdf: string; page: number; stamp: string; compact?: boolean }) {
  const src = `/api/page?pdf=${encodeURIComponent(view)}&page=${page}&w=${compact ? 560 : 900}&v=${stamp}`;
  const [done, setDone] = useState<{ src: string; ok: boolean }>();
  const state = done?.src !== src ? "loading" : done.ok ? "ok" : "failed";
  const highlighted = view !== pdf;
  const [opening, setOpening] = useState<string>();
  const [zoom, setZoom] = useState(false);
  const openInViewer = async () => {
    setOpening("opening…");
    try {
      const r = await fetch("/api/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: view, page }) });
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      setOpening(r.ok ? undefined : (body.error ?? `failed (${r.status})`));
    } catch {
      setOpening("the UI server is not running");
    }
  };
  return (
    <figure className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setZoom(true)}
        disabled={state === "failed"}
        title={highlighted ? "Read the page at full size, at the highlight" : "Read the page at full size"}
        className={cx("group relative block max-h-[30rem] cursor-zoom-in overflow-hidden rounded-lg bg-white text-left shadow-md ring-1 ring-stone-200 transition hover:shadow-lg hover:ring-teal-600/40 disabled:cursor-default", state !== "ok" && "aspect-[3/4]")}
      >
        {state === "loading" && <div className="absolute inset-0 animate-pulse bg-stone-100" />}
        {state === "failed" ? (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-stone-500">No preview of p.{page}</div>
        ) : (
          <img src={src} alt={`Page ${page} of ${basename(pdf)}`} onLoad={() => setDone({ src, ok: true })} onError={() => setDone({ src, ok: false })} className={cx("page block w-full", state !== "ok" && "opacity-0")} />
        )}
        {state === "ok" && (
          <span className="absolute right-2 bottom-2 flex items-center gap-1 rounded-md bg-stone-900/75 px-1.5 py-0.5 font-sans text-[11px] font-medium text-white opacity-90 fine:opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
            <Icon name="zoom" size={12} /> zoom
          </span>
        )}
      </button>
      {zoom && <Zoom view={view} pdf={pdf} page={page} stamp={stamp} highlighted={highlighted} onClose={() => setZoom(false)} />}
      <figcaption className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-stone-500">
        <span className="font-medium text-stone-700">p.{page}</span>
        <span>{highlighted ? "answer highlighted in a copy" : "the PDF itself, unmarked"}</span>
        <Actions className="ml-auto">
          <Action icon="external" label="open" href={pdfUrl(view, page)} title="Open the PDF at this page in a new tab" />
          <Action icon="window" label="in viewer" onClick={openInViewer} title="Open in your desktop PDF viewer, at the page" />
        </Actions>
        {opening && <span role="status" className={cx("w-full text-right", opening === "opening…" ? "text-stone-500" : "text-rose-700")}>{opening}</span>}
      </figcaption>
    </figure>
  );
}

/** The page large enough to read, scrolled to the highlight when there is one. */
function Zoom({ view, pdf, page, stamp, highlighted, onClose }: { view: string; pdf: string; page: number; stamp: string; highlighted: boolean; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [found, setFound] = useState<boolean>();
  const src = `/api/page?pdf=${encodeURIComponent(view)}&page=${page}&w=1400&v=${stamp}`;
  const toMark = (img: HTMLImageElement) => {
    const el = box.current;
    if (!el || !highlighted) return;
    const c = document.createElement("canvas");
    [c.width, c.height] = [img.naturalWidth, img.naturalHeight];
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return;
    g.drawImage(img, 0, 0);
    const rows = markRows(g.getImageData(0, 0, c.width, c.height).data, c.width);
    setFound(!!rows);
    if (!rows) return;
    const scale = img.clientHeight / img.naturalHeight;
    const middle = ((rows[0] + rows[1]) / 2) * scale;
    el.scrollTo({ top: Math.max(0, middle - el.clientHeight / 2), behavior: "smooth" });
  };
  return (
    <Dialog title={`Page ${page} of ${basename(pdf)}`} onClose={onClose} size="page">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-stone-100 px-4 py-2 text-xs text-stone-600">
        <span className="font-medium text-stone-800">{basename(pdf)}</span>
        <span>p.{page}</span>
        {highlighted && <span className="text-stone-500">{found === false ? "the highlight could not be found on the rendered page" : found ? "scrolled to the highlight" : ""}</span>}
        <Actions className="ml-auto">
          <Action icon="external" label="open" href={pdfUrl(view, page)} title="Open the PDF at this page in a new tab" />
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800">
            <Icon name="close" size={16} />
          </button>
        </Actions>
      </div>
      <div ref={box} tabIndex={0} aria-label="The page, scrollable" className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-stone-100 p-3 focus:outline-none">
        <img src={src} alt={`Page ${page} of ${basename(pdf)}, large`} onLoad={(e) => toMark(e.currentTarget)} className="page mx-auto block w-full max-w-[1400px] rounded bg-white shadow" />
      </div>
    </Dialog>
  );
}
