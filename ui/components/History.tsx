import { useState } from "react";
import { filterRuns, ordered } from "../history";
import { OUTCOME, runSpend, TOOL_LABEL } from "../labels";
import { outcomeOf, type Run } from "../run";
import { ago, cx, dollars, useTick } from "../util";

type Props = { runs: Run[]; current?: string; onOpen: (r: Run) => void; onClear: () => void; onPin: (id: string) => void; onDelete: (id: string) => void };

export function History({ runs, current, onOpen, onClear, onPin, onDelete }: Props) {
  const now = useTick(true, 30_000);
  const [needle, setNeedle] = useState("");
  if (runs.length === 0)
    return <div className="m-3 rounded-xl border border-dashed border-stone-300 p-4 text-center text-xs text-stone-500">Questions you ask appear here, with what each one cost.</div>;
  const shown = ordered(filterRuns(runs, needle));
  const pinned = runs.filter((r) => r.pinned).length;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {runs.length > 3 && (
        <div className="px-3 pt-3">
          <input
            value={needle}
            onChange={(e) => setNeedle(e.target.value)}
            placeholder={`Search ${runs.length} runs`}
            aria-label="Search the history"
            className="w-full rounded-lg border border-transparent bg-stone-100 px-2.5 py-1.5 text-xs placeholder:text-stone-400 focus:border-stone-200 focus:bg-white focus:outline-none"
          />
        </div>
      )}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {shown.length === 0 && <div className="px-2 py-3 text-center text-xs text-stone-400">No run matches “{needle}”</div>}
        <ul>
          {shown.map((r) => {
            const o = OUTCOME[outcomeOf(r)];
            return (
              <li key={r.id} className={cx("group relative rounded-lg", r.id === current ? "bg-white shadow-sm ring-1 ring-stone-200" : "hover:bg-stone-100")}>
                <button onClick={() => onOpen(r)} aria-current={r.id === current ? "true" : undefined} className="w-full rounded-lg px-2.5 py-2 pr-12 text-left">
                  <div className="line-clamp-2 text-[13px] leading-snug text-stone-800">{r.request.question}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] whitespace-nowrap text-stone-400" title={`${o.label} · ${TOOL_LABEL[r.request.tool]} · ${new Date(r.at).toLocaleString()}`}>
                    <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", o.dot)} />
                    <span className="truncate">{o.label}</span>
                    <span className="rounded bg-stone-200/60 px-1 text-stone-500">{TOOL_LABEL[r.request.tool]}</span>
                    <span className="ml-auto tabular-nums">{dollars(runSpend(r))}</span>
                    <span className="text-stone-300">{ago(r.at, now)}</span>
                  </div>
                </button>
                <div className={cx("absolute top-1.5 right-1.5 flex gap-0.5", !r.pinned && "opacity-0 group-hover:opacity-100 focus-within:opacity-100")}>
                  <button
                    onClick={() => onPin(r.id)}
                    aria-label={r.pinned ? "Unpin" : "Pin"}
                    aria-pressed={!!r.pinned}
                    title={r.pinned ? "Unpin: it may fall off the history when it fills" : "Pin: keep it however the history fills"}
                    className={cx("rounded px-1 text-xs", r.pinned ? "text-teal-700" : "text-stone-400 hover:text-stone-700")}
                  >
                    {r.pinned ? "★" : "☆"}
                  </button>
                  <button onClick={() => onDelete(r.id)} aria-label="Delete" title="Delete this run" className="rounded px-1 text-sm text-stone-400 hover:text-rose-600">
                    ×
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <button onClick={onClear} className="mt-2 w-full rounded-lg py-1.5 text-xs text-stone-400 hover:bg-stone-100 hover:text-stone-600">
          {pinned ? `Clear all but the ${pinned} pinned` : "Clear history"}
        </button>
      </div>
    </div>
  );
}
