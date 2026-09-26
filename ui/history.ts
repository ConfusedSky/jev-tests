/**
 * The history of runs this browser keeps: what stays when it fills up, how a
 * search over it matches, the order runs are stepped through, and which past
 * questions to offer for a new one.
 */
import { OUTCOME, TOOL_LABEL } from "./labels";
import { factsOf } from "./log";
import { outcomeOf, type Run } from "./run";
import type { JsonHit } from "./types";
import { basename } from "./util";

/** The unpinned beyond `cap` fall off, a pinned run never does. */
const capped = (runs: Run[], cap: number) => {
  let loose = 0;
  return runs.filter((r) => r.pinned || loose++ < cap);
};

/** `run` first, replacing an older copy of itself; the unpinned beyond `cap` fall off, a pinned run never does. */
export function remember(runs: Run[], run: Run, cap: number): Run[] {
  const old = runs.find((r) => r.id === run.id);
  return capped([{ ...run, pinned: run.pinned ?? old?.pinned }, ...runs.filter((r) => r.id !== run.id)], cap);
}

/** `removed` put back among `runs`, newest first; a run still there stays as it is, and the cap holds as in `remember`. */
export function restore(runs: Run[], removed: Run[], cap: number): Run[] {
  const have = new Set(runs.map((r) => r.id));
  return capped([...runs, ...removed.filter((r) => !have.has(r.id))].sort((a, b) => b.at - a.at), cap);
}

/** Pinned runs first, each group newest first: the sidebar's order. */
export const ordered = (runs: Run[]) => [...runs].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.at - a.at);

/** Newest first, pinned or not. */
export const byTime = (runs: Run[]) => [...runs].sort((a, b) => b.at - a.at);

/** The run `by` steps away from `id` in time, 1 older and -1 newer. From one not in the history, the live run or none, every run is older: back is the newest, forward is nothing. */
export function stepFrom(runs: Run[], id: string | undefined, by: 1 | -1): Run | undefined {
  const list = byTime(runs);
  const at = list.findIndex((r) => r.id === id);
  return at < 0 ? (by > 0 ? list[0] : undefined) : list[at + by];
}

/** The run that takes `id`'s place in `list` once it is gone: the one after it, else the one before. */
export function successor(list: Run[], id: string): Run | undefined {
  const at = list.findIndex((r) => r.id === id);
  return at < 0 ? undefined : (list[at + 1] ?? list[at - 1]);
}

/** A hit's answer as one line of text: a figure as it stands, a passage's paragraphs and rows run together. */
export const hitText = (h: JsonHit) => {
  const a = h.answer;
  if (!a) return "";
  const text = a.passage ? a.passage.map((p) => (p.table ? p.table.cells.filter(Boolean).join(" ") : p.text)).join(" ") : a.text;
  return text.replace(/\s+/g, " ").trim();
};

/** What a run came to, in a line: a figure, True or False, a passage's opening, a table's size, the names ranked best. */
export function answerOf(r: Run): string | undefined {
  const e = r.end;
  if (e?.ranked) return e.ranked.length ? e.ranked.map((x) => basename(x.name)).join(", ") : undefined;
  const report = e?.report;
  if (report?.table) return `a table of ${report.table.rows.length} × ${report.table.columns.length}`;
  const first = report?.hits[0];
  const text = first ? hitText(first) : "";
  if (!text) return undefined;
  if (report?.kind === "truth" && /^(true|false)$/i.test(text)) return text[0]!.toUpperCase() + text.slice(1).toLowerCase();
  return text.length > 160 ? `${text.slice(0, 160).replace(/\s\S*$/, "")}…` : text;
}

/** The kind of question the run was, from its report or, when it ended early, its log. */
export const kindOf = (r: Run): string | undefined => r.end?.report?.kind ?? factsOf(r.lines).kind;

/** The words a search matches against: the question, the tool, the outcome, the kind, the PDF a run asked, and what it answered. */
export function searchText(r: Run): string {
  const report = r.end?.report;
  const answers = [...(report?.hits.map(hitText) ?? []), ...(report?.table?.cells.flat().map((c) => c.text) ?? []), ...(r.end?.ranked?.map((x) => basename(x.name)) ?? [])];
  return [r.request.question, TOOL_LABEL[r.request.tool], OUTCOME[outcomeOf(r)].label, kindOf(r) ?? "", r.request.pdf ? basename(r.request.pdf) : "", ...answers].join(" ").toLowerCase();
}

/** Runs every word of `needle` appears in, in any order. */
export function filterRuns(runs: Run[], needle: string): Run[] {
  const words = needle.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return runs;
  return runs.filter((r) => {
    const text = searchText(r);
    return words.every((w) => text.includes(w));
  });
}

/** Up to `n` distinct earlier questions holding `text`, newest first, the one being typed left out. */
export function recentQuestions(runs: Run[], text: string, n = 5): string[] {
  const typed = text.trim().toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of byTime(runs)) {
    const q = r.request.question.trim();
    const key = q.toLowerCase();
    if (seen.has(key) || key === typed || !key.includes(typed)) continue;
    seen.add(key);
    out.push(q);
    if (out.length === n) break;
  }
  return out;
}
