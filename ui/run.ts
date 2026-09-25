import { useRef, useState } from "react";
import { parseLine, type Line } from "./log";
import type { RunEvent, RunRequest } from "./types";

type End = Extract<RunEvent, { type: "end" }>;

export type Run = {
  id: string;
  request: RunRequest;
  command: string;
  at: number;
  lines: Line[];
  trying?: string;
  status: "running" | "done" | "stopped";
  end?: End;
};

export type Outcome = "running" | "answered" | "below" | "unanswered" | "names" | "error" | "stopped";

export function outcomeOf(run: Run): Outcome {
  if (run.status === "running") return "running";
  if (run.status === "stopped") return "stopped";
  const e = run.end;
  if (e?.ranked) return "names";
  if (e?.report) return e.report.status;
  return "error";
}

function apply(r: Run, e: RunEvent): Run {
  switch (e.type) {
    case "log":
      return { ...r, lines: [...r.lines, parseLine(e.line, e.t)], trying: undefined };
    case "trying":
      return { ...r, trying: e.line };
    case "end":
      return { ...r, status: e.error === "stopped" ? "stopped" : "done", end: e, trying: undefined };
    default:
      return r;
  }
}

/** One run at a time, streamed from /api/run; `onDone` gets it once it has ended however it ended. */
export function useRun(onDone: (run: Run) => void) {
  const [run, setRun] = useState<Run>();
  const abort = useRef<AbortController | null>(null);

  async function start(request: RunRequest, command: string) {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    let cur: Run = { id: crypto.randomUUID(), request, command, at: Date.now(), lines: [], status: "running" };
    // A run started over this one has the screen; this one still ends into history.
    const update = (f: (r: Run) => Run) => {
      cur = f(cur);
      if (abort.current === ctrl) setRun(cur);
    };
    const fail = (error: string) => update((r) => ({ ...r, status: "done", trying: undefined, end: { type: "end", code: null, ms: Date.now() - r.at, error } }));
    setRun(cur);
    try {
      const res = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: ctrl.signal });
      if (!res.ok || !res.body) fail(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      else {
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          const events: RunEvent[] = [];
          for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
            events.push(JSON.parse(buf.slice(0, nl)) as RunEvent);
            buf = buf.slice(nl + 1);
          }
          if (events.length) update((r) => events.reduce(apply, r));
        }
        if (cur.status === "running") fail("the server closed the run before it ended");
      }
    } catch (e) {
      if (ctrl.signal.aborted) update((r) => ({ ...r, status: "stopped", trying: undefined, end: { type: "end", code: null, ms: Date.now() - r.at, error: "stopped" } }));
      else fail(e instanceof Error ? e.message : String(e));
    }
    onDone(cur);
    if (abort.current === ctrl) abort.current = null;
  }

  return { run, setRun, start, stop: () => abort.current?.abort() };
}
