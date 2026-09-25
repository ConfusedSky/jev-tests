import { spendOf } from "./log";
import type { Outcome, Run } from "./run";

export const OUTCOME: Record<Outcome, { label: string; dot: string; tone: string }> = {
  running: { label: "Running", dot: "bg-sky-500 animate-pulse", tone: "text-sky-700 bg-sky-50 ring-sky-600/20" },
  answered: { label: "Answered", dot: "bg-emerald-500", tone: "text-emerald-800 bg-emerald-50 ring-emerald-600/20" },
  names: { label: "Ranked", dot: "bg-emerald-500", tone: "text-emerald-800 bg-emerald-50 ring-emerald-600/20" },
  below: { label: "Below the floor", dot: "bg-amber-500", tone: "text-amber-800 bg-amber-50 ring-amber-600/20" },
  unanswered: { label: "No answer", dot: "bg-stone-400", tone: "text-stone-700 bg-stone-100 ring-stone-500/20" },
  error: { label: "Could not run", dot: "bg-rose-500", tone: "text-rose-800 bg-rose-50 ring-rose-600/20" },
  stopped: { label: "Stopped", dot: "bg-stone-400", tone: "text-stone-700 bg-stone-100 ring-stone-500/20" },
};

export const TOOL_LABEL = { jevfind: "Shelf", jevsec: "PDF", jevgrep: "Names" } as const;

export const runSpend = (r: Run) => r.end?.report?.spent.dollars ?? spendOf(r.lines).dollars;
