import { isTotal, spendOf, tree, type Node } from "./log";
import type { Tool } from "./options";
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

/** jev's price per million tokens in; output is free. labels.test.ts holds it to shared.ts, which the browser cannot import. */
export const PER_MILLION = 0.042;
export const PRICE = `$${PER_MILLION} per million tokens in`;

/** Tokens ranking a long outline afresh costs, as cache.ts says when the cache cannot run; held to it by labels.test.ts. */
export const AFRESH = 37_000;

export const runSpend = (r: Run) => r.end?.report?.spent.dollars ?? spendOf(r.lines).dollars;

/**
 * What this browser's runs have spent, in all and by day and mode (dollars,
 * keyed by local date then tool), and what each recent run was charged, by
 * its id.
 */
export type Ledger = { dollars: number; in: number; runs: number; days?: Record<string, Partial<Record<Tool, number>>>; charged?: Record<string, { dollars: number; in: number }> };

/** A day as the ledger keys it, the local date as YYYY-MM-DD. */
export const dayOf = (t: number) => new Date(t).toLocaleDateString("en-CA");

/** Days the ledger keeps its daily figures for; the totals keep everything. */
const KEEP_DAYS = 90;
/** Runs the ledger remembers charging; a run is charged again only as it ends, well within these. */
const KEEP_RUNS = 100;

/**
 * `ledger` with `run` added; a run the server never started spent nothing
 * and is no run. A run charged before is not counted again: only what it
 * spent since is added, as when a page saved it on leaving and then came
 * back from the back-forward cache to see it end.
 */
export function charge(ledger: Ledger, run: Run): Ledger {
  if (run.unsent) return ledger;
  const was = ledger.charged?.[run.id];
  const now = { dollars: runSpend(run), in: run.end?.report?.spent.in ?? spendOf(run.lines).in };
  const more = { dollars: Math.max(0, now.dollars - (was?.dollars ?? 0)), in: Math.max(0, now.in - (was?.in ?? 0)) };
  if (was && !more.dollars && !more.in) return ledger;
  const day = dayOf(run.at);
  const tool = run.request.tool;
  const days = { ...ledger.days, [day]: { ...ledger.days?.[day], [tool]: (ledger.days?.[day]?.[tool] ?? 0) + more.dollars } };
  const kept = Object.keys(days).sort().slice(-KEEP_DAYS);
  const charged = [...Object.entries(ledger.charged ?? {}).filter(([id]) => id !== run.id), [run.id, { dollars: (was?.dollars ?? 0) + more.dollars, in: (was?.in ?? 0) + more.in }] as const].slice(-KEEP_RUNS);
  return {
    dollars: ledger.dollars + more.dollars,
    in: ledger.in + more.in,
    runs: ledger.runs + (was ? 0 : 1),
    days: Object.fromEntries(kept.map((d) => [d, days[d]!])),
    charged: Object.fromEntries(charged),
  };
}

/** Dollars spent over the `n` days to `now`, today included, in all and by mode. */
export function spentOver(ledger: Ledger, n: number, now = Date.now()): { dollars: number; tools: Record<Tool, number> } {
  const tools: Record<Tool, number> = { jevfind: 0, jevsec: 0, jevgrep: 0 };
  const from = dayOf(now - (n - 1) * 86_400_000);
  for (const [day, spent] of Object.entries(ledger.days ?? {})) if (day >= from && day <= dayOf(now)) for (const t of Object.keys(tools) as Tool[]) tools[t] += spent[t] ?? 0;
  return { dollars: tools.jevfind + tools.jevsec + tools.jevgrep, tools };
}

export const ledgerOf = (runs: Run[]): Ledger => runs.reduce(charge, { dollars: 0, in: 0, runs: 0 });

/**
 * The call a stopped run left in flight, billed but never reported, sized as
 * the calls it did report averaged; none once the tool printed its total.
 */
export function inFlight(r: Run): { in?: number; dollars?: number } | undefined {
  if (r.status !== "stopped" || r.unsent || r.lines.some(isTotal)) return undefined;
  const leaves = (ns: Node[]): Node[] => ns.flatMap((n) => (n.children.length ? leaves(n.children) : n.line.cost ? [n] : []));
  const calls = leaves(tree(r.lines)).map((n) => n.line.cost!);
  if (calls.length === 0) return {};
  return { in: Math.round(calls.reduce((a, c) => a + c.in, 0) / calls.length), dollars: calls.reduce((a, c) => a + c.dollars, 0) / calls.length };
}
