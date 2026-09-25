/**
 * The history of runs this browser keeps: what stays when it fills up, how a
 * search over it matches, and which past questions to offer for a new one.
 */
import { OUTCOME, TOOL_LABEL } from "./labels";
import { outcomeOf, type Run } from "./run";
import { basename } from "./util";

/** `run` first, replacing an older copy of itself; the unpinned beyond `cap` fall off, a pinned run never does. */
export function remember(runs: Run[], run: Run, cap: number): Run[] {
  const old = runs.find((r) => r.id === run.id);
  const all = [{ ...run, pinned: run.pinned ?? old?.pinned }, ...runs.filter((r) => r.id !== run.id)];
  let loose = 0;
  return all.filter((r) => r.pinned || loose++ < cap);
}

/** Pinned runs first, each group newest first. */
export const ordered = (runs: Run[]) => [...runs].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.at - a.at);

/** The words a search matches against: the question, the tool, the outcome, and the PDF a run asked. */
export const searchText = (r: Run) => [r.request.question, TOOL_LABEL[r.request.tool], OUTCOME[outcomeOf(r)].label, r.request.pdf ? basename(r.request.pdf) : ""].join(" ").toLowerCase();

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
  for (const r of [...runs].sort((a, b) => b.at - a.at)) {
    const q = r.request.question.trim();
    const key = q.toLowerCase();
    if (seen.has(key) || key === typed || !key.includes(typed)) continue;
    seen.add(key);
    out.push(q);
    if (out.length === n) break;
  }
  return out;
}
