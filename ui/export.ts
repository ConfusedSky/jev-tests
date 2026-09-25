/**
 * Answers as text to take elsewhere: an answer or passage with the question
 * and where it stands, a table as CSV or Markdown, a run as one JSON file.
 */
import type { Run } from "./run";
import { outcomeOf } from "./run";
import type { JsonHit, JsonReport } from "./types";
import { basename, plainTitle } from "./util";

type Para = NonNullable<NonNullable<JsonHit["answer"]>["passage"]>[number];
type TableRow = NonNullable<Para["table"]>;

/** A window of a book without an outline is named by its page, which the citation already gives. */
const byPage = (section: string) => /^p\.\d+(-\d+)?$/.test(section);

/** "book.pdf, p.12 (Chapter > Section)", enough to find the answer again. */
export function citation(hit: JsonHit): string {
  const where = `${basename(hit.pdf)}, p.${hit.page}`;
  return byPage(hit.section) ? where : `${where} (${plainTitle(hit.section)})`;
}

/** A passage as plain text: a heading on its line, a table's heads before its first row, each row's cells tab-separated. */
export function passageText(paras: Para[]): string {
  const out: string[] = [];
  let heads: string | undefined;
  for (const p of paras) {
    if (!p.table) {
      heads = undefined;
      out.push(p.text);
      continue;
    }
    const key = p.table.heads.join("\t");
    if (key !== heads && key.trim()) out.push(key);
    heads = key;
    out.push(p.table.cells.join("\t"));
  }
  return out.join("\n");
}

/** What was asked and how sure the answer is, beside the hit itself. */
export type Asked = { question: string; floor: number; below?: boolean };

/** The answer as a reader pastes it: the question, a figure on one line or a passage in full, then where it stands and how sure it is. */
export function answerText(hit: JsonHit, asked: Asked): string {
  const a = hit.answer;
  const body = !a ? "" : a.passage ? passageText(a.passage) : a.text;
  const sure = a ? ` · p=${a.p.toFixed(2)}${asked.below || a.p < asked.floor ? `, below the answer floor ${asked.floor}` : ""}` : "";
  return [`Q: ${asked.question}`, ...(body ? [body] : []), `— ${citation(hit)}${sure}`].join("\n");
}

/** The rows of a passage's table under its heads, a row with one cell kept as it stands. */
export function tableGrid(rows: TableRow[]): string[][] {
  const heads = rows[0]?.heads ?? [];
  return [heads, ...rows.map((r) => r.cells)];
}

/** A table across the shelf as a grid: a head row, then each document's row; a cell left without an answer says why. */
export function acrossGrid(t: NonNullable<JsonReport["table"]>): string[][] {
  return [["document", ...t.columns], ...t.rows.map((r, i) => [r, ...t.cells[i]!.map((c) => (c.why ? `${c.text} (${c.why})` : c.text))])];
}

/** The line a saved table ends on, so a file found later says where it came from. */
export const sourceLine = (question: string, from: string) => `Source: ${from}. Asked of jev: “${question}”`;

const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
/** The grid as CSV; a source goes last, after an empty row, so the head row stays the first. */
export const csv = (grid: string[][], source?: string): string =>
  [...grid, ...(source ? [[], [source]] : [])].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";

const mdCell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
export function markdown(grid: string[][], source?: string): string {
  const [head, ...rows] = grid;
  if (!head) return "";
  const width = Math.max(head.length, ...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => mdCell(r[i] ?? "")).join(" | ")} |`;
  const table = [line(head), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.map(line)].join("\n") + "\n";
  return source ? `${table}\n${source}\n` : table;
}

/** A run as one JSON document: what was asked, what came back, and the log as the tool printed it, each line with its time since the start. */
export function runJson(run: Run): string {
  const { request, command, at, end } = run;
  const outcome = outcomeOf(run);
  const log = run.lines.map((l) => ({ ms: l.t, line: "  ".repeat(l.depth) + l.text }));
  return JSON.stringify({ id: run.id, at: new Date(at).toISOString(), outcome, request, command, report: end?.report, ranked: end?.ranked, error: end?.error, ms: end?.ms, log }, null, 2);
}

/** A file name a run's export can take: the question's first words, safe on any disk. */
export function fileStem(question: string, max = 40): string {
  const slug = question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  return (slug.length > max ? slug.slice(0, max).replace(/-[^-]*$/, "") : slug) || "run";
}
