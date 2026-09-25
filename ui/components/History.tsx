import { spendOf } from "../log";
import { outcomeOf, type Outcome, type Run } from "../run";
import { ago, cx, dollars } from "../util";

export const OUTCOME: Record<Outcome, { label: string; dot: string; tone: string }> = {
  running: { label: "Running", dot: "bg-sky-500 animate-pulse", tone: "text-sky-700 bg-sky-50 ring-sky-600/20" },
  answered: { label: "Answered", dot: "bg-emerald-500", tone: "text-emerald-800 bg-emerald-50 ring-emerald-600/20" },
  names: { label: "Ranked", dot: "bg-emerald-500", tone: "text-emerald-800 bg-emerald-50 ring-emerald-600/20" },
  below: { label: "Below the floor", dot: "bg-amber-500", tone: "text-amber-800 bg-amber-50 ring-amber-600/20" },
  unanswered: { label: "No answer", dot: "bg-stone-400", tone: "text-stone-700 bg-stone-100 ring-stone-500/20" },
  error: { label: "Could not run", dot: "bg-rose-500", tone: "text-rose-800 bg-rose-50 ring-rose-600/20" },
  stopped: { label: "Stopped", dot: "bg-stone-400", tone: "text-stone-700 bg-stone-100 ring-stone-500/20" },
};

export const TOOL_LABEL = { jevfind: "Shelf", jevsec: "One PDF", jevgrep: "Names" } as const;

export const runSpend = (r: Run) => r.end?.report?.spent.dollars ?? spendOf(r.lines).dollars;

export function History({ runs, current, onOpen, onClear }: { runs: Run[]; current?: string; onOpen: (r: Run) => void; onClear: () => void }) {
  if (runs.length === 0)
    return <div className="m-3 rounded-xl border border-dashed border-stone-300 p-4 text-center text-xs text-stone-500">Questions you ask appear here, with what each one cost.</div>;
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-2">
      <ul>
        {runs.map((r) => {
          const o = OUTCOME[outcomeOf(r)];
          return (
            <li key={r.id}>
              <button onClick={() => onOpen(r)} className={cx("w-full rounded-lg px-2.5 py-2 text-left", r.id === current ? "bg-white shadow-sm ring-1 ring-stone-200" : "hover:bg-stone-100")}>
                <div className="line-clamp-2 text-[13px] leading-snug text-stone-800">{r.request.question}</div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-stone-400">
                  <span className={cx("h-1.5 w-1.5 rounded-full", o.dot)} />
                  <span>{o.label}</span>
                  <span>·</span>
                  <span>{TOOL_LABEL[r.request.tool]}</span>
                  <span className="ml-auto tabular-nums">{dollars(runSpend(r))}</span>
                  <span>·</span>
                  <span>{ago(r.at)}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <button onClick={onClear} className="mt-2 w-full rounded-lg py-1.5 text-xs text-stone-400 hover:bg-stone-100 hover:text-stone-600">
        Clear history
      </button>
    </div>
  );
}
