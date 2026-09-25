import { useMemo, useState } from "react";
import type { Scan } from "../types";
import { isLocate } from "../sources";
import { basename, bytes, cx, dirname, secs } from "../util";

type Props = {
  folders: string[];
  scans: Record<string, Scan | undefined>;
  picked?: string;
  onAdd: (dir: string) => Promise<string | undefined>;
  onRemove: (dir: string) => void;
  onRescan: (dir: string) => void;
  onPick: (path: string) => void;
};

export function Shelf({ folders, scans, picked, onAdd, onRemove, onRescan, onPick }: Props) {
  const [dir, setDir] = useState("");
  const [problem, setProblem] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("");
  const total = new Set(folders.flatMap((f) => scans[f]?.files.map((x) => x.path) ?? [])).size;
  const needle = filter.trim().toLowerCase();

  const add = async () => {
    if (!dir.trim()) return;
    setAdding(true);
    const why = await onAdd(dir.trim());
    setAdding(false);
    setProblem(why);
    if (!why) setDir("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form
        className="flex gap-1.5 px-3 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          value={dir}
          onChange={(e) => {
            setDir(e.target.value);
            setProblem(undefined);
          }}
          placeholder="A folder, or plocate -i '*.pdf'"
          aria-label="Folder of PDFs, or a locate command, to add"
          title="A folder puts every PDF under it on the shelf; a locate command (plocate, locate) puts every PDF it lists. The command runs without a shell, so no pipes."
          className="min-w-0 flex-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-xs placeholder:font-sans placeholder:text-stone-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
        />
        <button type="submit" disabled={!dir.trim() || adding} className="rounded-lg bg-stone-800 px-2.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-30">
          {adding ? "…" : "Add"}
        </button>
      </form>
      {problem && (
        <div role="alert" className="mx-3 mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] [overflow-wrap:anywhere] text-amber-800 ring-1 ring-amber-600/20">
          {problem}
        </div>
      )}

      {total > 8 && (
        <div className="px-3 pt-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filter ${total} PDFs`}
            aria-label="Filter the shelf"
            className="w-full rounded-lg border border-transparent bg-stone-100 px-2.5 py-1.5 text-xs placeholder:text-stone-400 focus:border-stone-200 focus:bg-white focus:outline-none"
          />
        </div>
      )}

      <div className="scroll-thin mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {folders.length === 0 && (
          <div className="mx-1 mt-2 rounded-xl border border-dashed border-stone-300 p-4 text-center text-xs leading-relaxed text-stone-500">
            <div className="mb-1 text-sm font-medium text-stone-700">Your shelf is empty</div>
            Add a folder above, and every PDF under it goes on the shelf. Or add a locate command, such as{" "}
            <code className="rounded bg-stone-100 px-1 font-mono text-[11px] text-stone-700">plocate -i '*.pdf'</code>, and every PDF it lists does, without walking the disk. Nothing is read or sent until you ask.
          </div>
        )}
        {folders.map((f) => (
          <Folder key={f} dir={f} scan={scans[f]} needle={needle} picked={picked} onRemove={() => onRemove(f)} onRescan={() => onRescan(f)} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

function Folder({ dir, scan, needle, picked, onRemove, onRescan, onPick }: { dir: string; scan?: Scan; needle: string; picked?: string; onRemove: () => void; onRescan: () => void; onPick: (p: string) => void }) {
  const [open, setOpen] = useState(true);
  const command = isLocate(dir);
  // A command's PDFs lie anywhere; each is shown under the folder it shares with the rest.
  const root = useMemo(() => (command ? commonDir((scan?.files ?? []).map((f) => f.path)) : dir), [command, scan, dir]);
  const files = useMemo(() => (scan?.files ?? []).filter((f) => !needle || f.path.slice(root.length).toLowerCase().includes(needle)), [scan, needle, root]);
  return (
    <section className="mb-2">
      <div className="group flex items-center gap-1 rounded-lg px-1.5 py-1 hover:bg-stone-100">
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" title={command ? `${dir}\n${scan?.files.length ?? 0} PDFs it lists${root ? `, under ${root}` : ""}` : dir} aria-expanded={open}>
          <span className={cx("text-[10px] text-stone-400 transition-transform", open && "rotate-90")}>▶</span>
          {command ? (
            <span className="truncate rounded bg-stone-200/70 px-1 font-mono text-[11px] font-medium text-stone-700">$ {dir}</span>
          ) : (
            <span className="truncate text-xs font-semibold text-stone-700">{basename(dir) || dir}</span>
          )}
          <span className="shrink-0 text-[11px] text-stone-400">
            {!scan ? (command ? "running…" : "scanning…") : scan.error ? "error" : `${scan.files.length}${scan.truncated ? "+" : ""} · ${secs(scan.ms)}`}
          </span>
        </button>
        <button onClick={onRescan} className="rounded px-1 text-xs text-stone-400 opacity-0 hover:text-stone-700 group-hover:opacity-100" title={command ? "Run again" : "Scan again"} aria-label={`${command ? "Run" : "Scan"} ${dir} again`}>
          ↻
        </button>
        <button onClick={onRemove} className="rounded px-1 text-sm text-stone-400 opacity-0 hover:text-rose-600 group-hover:opacity-100" title="Take off the shelf" aria-label={`Remove ${dir}`}>
          ×
        </button>
      </div>
      {scan?.error && <div className="mx-2 rounded-md bg-rose-50 px-2 py-1 text-[11px] text-rose-700">{scan.error}</div>}
      {open && (
        <ul className="mt-0.5">
          {files.map((f) => {
            const rel = root ? f.path.slice(root.length + 1) : f.path;
            const sub = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
            const on = f.path === picked;
            return (
              <li key={f.path}>
                <button
                  onClick={() => onPick(f.path)}
                  title={`${f.path}\nClick to ask this PDF alone`}
                  className={cx("group/f flex w-full items-center gap-2 rounded-lg py-1 pr-2 pl-5 text-left", on ? "bg-teal-50 ring-1 ring-teal-600/20" : "hover:bg-stone-100")}
                >
                  <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", on ? "bg-teal-600" : "bg-stone-300")} />
                  <span className="min-w-0 flex-1">
                    <span className={cx("block truncate text-[13px]", on ? "font-medium text-teal-900" : "text-stone-700")}>{f.name}</span>
                    {sub && <span className="block truncate text-[11px] text-stone-400">{sub}</span>}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-stone-400">{bytes(f.size)}</span>
                </button>
              </li>
            );
          })}
          {scan && !scan.error && files.length === 0 && <li className="py-1 pl-5 text-xs text-stone-400">{needle ? "no match" : "no PDFs here"}</li>}
        </ul>
      )}
    </section>
  );
}

/** The deepest folder holding every one of `paths`. */
function commonDir(paths: string[]): string {
  if (paths.length === 0) return "";
  let dir = dirname(paths[0]!);
  while (dir !== "/" && !paths.every((p) => p.startsWith(`${dir}/`))) dir = dirname(dir);
  return dir === "/" ? "" : dir;
}
