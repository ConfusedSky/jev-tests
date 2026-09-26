import { useEffect, useState } from "react";
import { OFFLINE } from "../run";
import type { DocInfo, Mark, PageSize } from "../types";
import { basename, cx, plural } from "../util";
import { placed, type Spot } from "../viewer";
import { Icon } from "./Icon";

/**
 * What the server can serve: `boot` is when it started, and `listed` counts
 * the shelf's listings, so a PDF is asked about again once a restarted
 * server has been shown it. `pending` while a source is being listed.
 */
export type Served = { boot?: number; listed: number; pending: boolean; down: boolean };

type Doc = { info?: DocInfo; boot?: number; error?: string };

const asked = new Map<string, Promise<DocInfo>>();
function docInfo(pdf: string, key: string): Promise<DocInfo> {
  let p = asked.get(key);
  if (!p) {
    p = fetch(`/api/doc?pdf=${encodeURIComponent(pdf)}`).then(
      async (r) => {
        const body = (await r.json().catch(() => ({}))) as Partial<DocInfo> & { error?: string };
        if (!r.ok || !body.pages) throw new Error(body.error ?? `the server answered ${r.status}`);
        return { pages: body.pages, mtime: body.mtime ?? 0 };
      },
      () => {
        throw new Error(OFFLINE);
      },
    );
    asked.set(key, p);
    p.catch(() => asked.delete(key));
  }
  return p;
}

/**
 * A PDF's page sizes, asked for again whenever the server restarts or the
 * shelf is listed afresh. `boot` is the start of the server that last served
 * them, which a page's address carries, so a page it refused is asked for
 * again from the next.
 */
export function useDoc(pdf: string | undefined, served: Served): Doc {
  const [state, setState] = useState<Doc & { pdf: string; key: string }>();
  const key = pdf && served.boot !== undefined ? `${served.boot}\0${served.listed}\0${pdf}` : undefined;
  useEffect(() => {
    if (!pdf || !key) return;
    let live = true;
    const boot = served.boot;
    docInfo(pdf, key).then(
      (info) => live && setState({ pdf, key, info, boot }),
      (e: unknown) => live && setState((s) => ({ ...(s?.pdf === pdf ? s : {}), pdf, key, error: e instanceof Error ? e.message : String(e) })),
    );
    return () => {
      live = false;
    };
  }, [key]);
  const mine = state?.pdf === pdf ? state : undefined;
  // While the shelf is listed, a refusal only means the server has not been shown the PDF yet.
  const error = served.down ? OFFLINE : mine?.key === key && !served.pending ? mine?.error : undefined;
  return { info: mine?.info, boot: mine?.boot, error };
}

/** Why a PDF's pages cannot be shown, as a reader would put it. */
export function docProblem(error: string): string {
  if (error === "not on the shelf") return "This PDF is not on the shelf now. Add its folder back to the shelf to read its pages.";
  if (error === OFFLINE) return "The UI server is not running; the pages come back when it does.";
  return `Could not read its pages: ${error}`;
}

export const sizeOf = (info: DocInfo | undefined, page: number): PageSize | undefined => {
  const p = info?.pages[page - 1];
  return p && { width: p[0], height: p[1] };
};

/** A page drawn `w` pixels wide; the address names the file's mtime and the server's start, so it changes whenever what it shows could. */
export const pageSrc = (pdf: string, page: number, w: number, doc: Doc) => `/api/page?pdf=${encodeURIComponent(pdf)}&page=${page}&w=${w}&m=${doc.info?.mtime ?? 0}&v=${doc.boot ?? 0}`;

/** A drawn page, filling its box; a new address keeps the old drawing up until the new one has come. */
export function PageImage({ src, alt }: { src: string; alt: string }) {
  const [done, setDone] = useState<{ src: string; ok: boolean }>();
  const [seen, setSeen] = useState(false);
  if (done?.src === src && !done.ok) return <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-stone-500">No image of this page</div>;
  return (
    <>
      {!seen && <div aria-hidden="true" className="absolute inset-0 animate-pulse bg-stone-100" />}
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={() => {
          setDone({ src, ok: true });
          setSeen(true);
        }}
        onError={() => setDone({ src, ok: false })}
        className={cx("page absolute inset-0 h-full w-full select-none", !seen && "opacity-0")}
      />
    </>
  );
}

/** Marks over a drawn page, placed by the page's size; `now` marks the highlight being shown, with a bar in the margin beside it to find it by. */
export function MarkLayer({ groups }: { groups: { marks: Mark[]; size: PageSize; now: boolean }[] }) {
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {groups.map((g, i) => {
        const top = Math.min(...g.marks.map((m) => m.y0));
        const bottom = Math.max(...g.marks.map((m) => m.y1));
        return (
          <div key={i}>
            {g.marks.map((m, j) => {
              const at = placed(m, g.size);
              return <span key={j} className={cx("mark", g.now && "mark-now")} style={{ left: `${at.left}%`, top: `${at.top}%`, width: `${at.width}%`, height: `${at.height}%` }} />;
            })}
            {g.now && g.marks.length > 0 && <span className="mark-bar" style={{ top: pct(top, g.size.height), height: pct(bottom - top, g.size.height) }} />}
          </div>
        );
      })}
    </div>
  );
}

/** A highlighted page small, in an answer's card: the page with its marks, opening the viewer on it. */
export function PageThumb({ spot, served, onOpen }: { spot: Spot; served: Served; onOpen: () => void }) {
  const doc = useDoc(spot.pdf, served);
  const size = spot.size ?? sizeOf(doc.info, spot.page);
  const name = basename(spot.pdf);
  return (
    <figure className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onOpen}
        title="Read the document here, at this page, with every highlight of the run"
        style={{ aspectRatio: size ? `${size.width} / ${size.height}` : "3 / 4" }}
        className="group relative block w-full cursor-zoom-in overflow-hidden rounded-lg bg-white text-left shadow-md ring-1 ring-stone-200 transition hover:shadow-lg hover:ring-teal-600/40"
      >
        {doc.info && <PageImage src={pageSrc(spot.pdf, spot.page, 640, doc)} alt={`Page ${spot.page} of ${name}`} />}
        {doc.error && !doc.info && <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-stone-500">{docProblem(doc.error)}</div>}
        {size && spot.marks.length > 0 && <MarkLayer groups={[{ marks: spot.marks, size, now: true }]} />}
        <span className="absolute right-2 bottom-2 flex items-center gap-1 rounded-md bg-stone-900/75 px-1.5 py-0.5 font-sans text-[11px] font-medium text-white opacity-90 fine:opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
          <Icon name="zoom" size={12} /> read on the page
        </span>
      </button>
      <figcaption className="text-[11px] text-stone-500">
        <span className="font-medium text-stone-700">p.{spot.page}</span> · {spot.marks.length > 0 ? plural(spot.marks.length, "mark") : spot.unmarked}
      </figcaption>
    </figure>
  );
}
