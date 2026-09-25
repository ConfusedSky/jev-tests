/**
 * What /api/run is sent, checked before any tool runs: every field of the
 * type the UI sends and every option within its spec, so nothing malformed
 * reaches a command line that spends money.
 */
import { DEFAULTS, invalid, SPECS, type Options, type Spec, type Tool } from "./options";
import type { RunRequest } from "./types";

const TOOLS: readonly string[] = ["jevsec", "jevfind", "jevgrep"] satisfies Tool[];

const plain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Why `v` is not a value `s` takes, or undefined when it is. */
function mistyped(s: Spec, v: unknown): string | undefined {
  if (s.type === "number") return typeof v === "number" && Number.isFinite(v) ? undefined : "a number";
  if (s.type === "toggle") return typeof v === "boolean" ? undefined : "true or false";
  if (s.type === "select") return typeof v === "string" && s.values.includes(v) ? undefined : `one of ${s.values.join(", ")}`;
  return typeof v === "string" ? undefined : "text";
}

/**
 * The request as the server would run it, or why it will not. Options it
 * does not know are dropped, since a browser's stored form can keep a key
 * from an older UI; the rest must be of their spec's type, and a number in
 * its range for the tool. Paths go to the tool a line each.
 */
export function checkRequest(body: unknown): { request: RunRequest } | { error: string } {
  if (!plain(body)) return { error: "the request must be a JSON object" };
  const { tool, question, options = {}, pdf, paths } = body;
  if (typeof tool !== "string" || !TOOLS.includes(tool)) return { error: "unknown tool" };
  if (typeof question !== "string" || !question.trim()) return { error: "ask a question" };
  if (!plain(options)) return { error: "options must be a JSON object" };
  const o: Options = { ...DEFAULTS };
  for (const s of SPECS) {
    if (!(s.key in options)) continue;
    const why = mistyped(s, options[s.key]);
    if (why) return { error: `the option ${s.key} must be ${why}` };
    Object.assign(o, { [s.key]: options[s.key] });
  }
  const t = tool as Tool;
  const range = invalid(t, o);
  if (range) return { error: range };
  if (t === "jevsec") return typeof pdf === "string" && pdf ? { request: { tool: t, question, options: o, pdf } } : { error: "choose a PDF from the shelf" };
  if (!Array.isArray(paths) || paths.length === 0) return { error: "the shelf is empty" };
  if (!paths.every((p): p is string => typeof p === "string" && !!p.trim() && !/[\n\r\0]/.test(p))) return { error: "every path must be a file's path, as text on one line" };
  return { request: { tool: t, question, options: o, paths } };
}
