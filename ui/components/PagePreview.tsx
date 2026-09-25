import { useState } from "react";
import { basename, cx } from "../util";

export const pdfUrl = (path: string, page: number) => `/api/pdf?path=${encodeURIComponent(path)}#page=${page}`;

/** The page as rendered by mutool, the answer's highlight on it, and the ways to open it. */
export function PagePreview({ view, pdf, page, stamp, compact }: { view: string; pdf: string; page: number; stamp: string; compact?: boolean }) {
  const src = `/api/page?pdf=${encodeURIComponent(view)}&page=${page}&w=${compact ? 560 : 900}&v=${stamp}`;
  const [done, setDone] = useState<{ src: string; ok: boolean }>();
  const state = done?.src !== src ? "loading" : done.ok ? "ok" : "failed";
  const highlighted = view !== pdf;
  return (
    <figure className="flex flex-col gap-2">
      <a
        href={pdfUrl(view, page)}
        target="_blank"
        rel="noreferrer"
        title="Open the PDF at this page in a new tab"
        className={cx("relative block max-h-[30rem] overflow-hidden rounded-lg bg-white shadow-md ring-1 ring-stone-200 transition hover:shadow-lg hover:ring-teal-600/40", state !== "ok" && "aspect-[3/4]")}
      >
        {state === "loading" && <div className="absolute inset-0 animate-pulse bg-stone-100" />}
        {state === "failed" ? (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-stone-400">No preview of p.{page}</div>
        ) : (
          <img src={src} alt={`Page ${page} of ${basename(pdf)}`} onLoad={() => setDone({ src, ok: true })} onError={() => setDone({ src, ok: false })} className={cx("block w-full", state !== "ok" && "opacity-0")} />
        )}
      </a>
      <figcaption className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-stone-500">
        <span className="font-medium text-stone-700">p.{page}</span>
        <span>{highlighted ? "answer highlighted in a copy" : "the PDF itself, unmarked"}</span>
        <span className="ml-auto flex gap-1">
          <a href={pdfUrl(view, page)} target="_blank" rel="noreferrer" className="rounded-md px-1.5 py-0.5 text-teal-700 hover:bg-teal-50">
            open ↗
          </a>
          <button
            onClick={() => fetch("/api/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: view, page }) })}
            className="rounded-md px-1.5 py-0.5 text-teal-700 hover:bg-teal-50"
            title="Open in your desktop PDF viewer, at the page"
          >
            in viewer
          </button>
        </span>
      </figcaption>
    </figure>
  );
}
