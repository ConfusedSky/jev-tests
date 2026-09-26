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
  /** Kept in the history however full it gets. */
  pinned?: boolean;
  /** The server never started the tool: it could not be reached, or it refused the request. Nothing was spent. */
  unsent?: "offline" | "refused";
  /** Stopped because the page was closed or reloaded while it ran. */
  left?: boolean;
};

export type Outcome = "running" | "answered" | "below" | "unanswered" | "names" | "error" | "stopped";

export function outcomeOf(run: Run): Outcome {
  if (run.status === "running") return "running";
  if (run.status === "stopped") return "stopped";
  const e = run.end;
  if (e?.ranked) return e.ranked.length ? "names" : "unanswered";
  if (e?.report) return e.report.status;
  return "error";
}

const stopped = (r: Run, now: number): Run => ({ ...r, status: "stopped", trying: undefined, end: { type: "end", code: null, ms: now - r.at, error: "stopped" } });

/** A live run as the history keeps it once the page it ran in is gone: stopped, with what it logged. */
export const leftRun = (r: Run, now: number): Run => ({ ...stopped(r, now), left: true });

export const OFFLINE = "the UI server is not running";

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

  /** Starts the run and returns its id at once; the run itself streams in behind. */
  function start(request: RunRequest, command: string): string {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const cur: Run = { id: crypto.randomUUID(), request, command, at: Date.now(), lines: [], status: "running" };
    setRun(cur);
    void stream(cur, ctrl);
    return cur.id;
  }

  async function stream(cur: Run, ctrl: AbortController) {
    const request = cur.request;
    // A run started over this one has the screen; this one still ends into history.
    const update = (f: (r: Run) => Run) => {
      cur = f(cur);
      if (abort.current === ctrl) setRun(cur);
    };
    const fail = (error: string, unsent?: Run["unsent"]) => update((r) => ({ ...r, status: "done", trying: undefined, unsent, end: { type: "end", code: null, ms: Date.now() - r.at, error } }));
    let res: Response | undefined;
    try {
      res = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: ctrl.signal });
    } catch {
      // fetch throws only when no answer came at all.
      if (ctrl.signal.aborted) update((r) => stopped(r, Date.now()));
      else fail(OFFLINE, "offline");
    }
    if (res && (!res.ok || !res.body)) fail(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`, "refused");
    else if (res?.body) {
      try {
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
      } catch (e) {
        if (ctrl.signal.aborted) update((r) => stopped(r, Date.now()));
        else fail(`the UI server stopped answering during the run (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    onDone(cur);
    if (abort.current === ctrl) abort.current = null;
  }

  return { run, setRun, start, stop: () => abort.current?.abort() };
}
