/**
 * Answers as text to take elsewhere: an answer or passage with where it
 * stands, a table as CSV or Markdown, a run as one JSON file.
 */
import type { Run } from "./run";
import { outcomeOf } from "./run";
import type { JsonHit, JsonReport } from "./types";
import { basename } from "./util";

type Para = NonNullable<NonNullable<JsonHit["answer"]>["passage"]>[number];
type TableRow = NonNullable<Para["table"]>;

/** A window of a book without an outline is named by its page, which the citation already gives. */
const byPage = (section: string) => /^p\.\d+(-\d+)?$/.test(section);

/** "book.pdf, p.12 (Chapter > Section)", enough to find the answer again. */
export function citation(hit: JsonHit): string {
  const where = `${basename(hit.pdf)}, p.${hit.page}`;
  return byPage(hit.section) ? where : `${where} (${hit.section})`;
}

/** A passage as plain text: a heading on its line, a table row's cells tab-separated. */
export const passageText = (paras: Para[]): string => paras.map((p) => (p.table ? p.table.cells.join("\t") : p.text)).join("\n");

/** The answer and its citation, as a reader pastes it: a figure on one line, a passage in full. */
export function answerText(hit: JsonHit): string {
  const a = hit.answer;
  const body = !a ? "" : a.passage ? passageText(a.passage) : a.text;
  return `${body}${body ? "\n" : ""}— ${citation(hit)}`;
}

/** The rows of a passage's table under its heads, a row with one cell kept as it stands. */
export function tableGrid(rows: TableRow[]): string[][] {
  const heads = rows[0]?.heads ?? [];
  return [heads, ...rows.map((r) => r.cells)];
}

/** A table across the shelf as a grid: a head row, then each document's row. */
export function acrossGrid(t: NonNullable<JsonReport["table"]>): string[][] {
  return [["document", ...t.columns], ...t.rows.map((r, i) => [r, ...t.cells[i]!.map((c) => c.text)])];
}

const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
export const csv = (grid: string[][]): string => grid.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";

const mdCell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
export function markdown(grid: string[][]): string {
  const [head, ...rows] = grid;
  if (!head) return "";
  const width = Math.max(head.length, ...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => mdCell(r[i] ?? "")).join(" | ")} |`;
  return [line(head), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.map(line)].join("\n") + "\n";
}

/** A run as one JSON document: what was asked, what came back, and the log as the tool printed it. */
export function runJson(run: Run): string {
  const { request, command, at, end } = run;
  const outcome = outcomeOf(run);
  const log = run.lines.map((l) => "  ".repeat(l.depth) + l.text);
  return JSON.stringify({ id: run.id, at: new Date(at).toISOString(), outcome, request, command, report: end?.report, ranked: end?.ranked, error: end?.error, ms: end?.ms, log }, null, 2);
}

/** A file name a run's export can take: the question's first words, safe on any disk. */
export function fileStem(question: string, max = 40): string {
  const slug = question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  return (slug.length > max ? slug.slice(0, max).replace(/-[^-]*$/, "") : slug) || "run";
}
