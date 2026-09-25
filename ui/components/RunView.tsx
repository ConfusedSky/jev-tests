import { useState, type ReactNode } from "react";
import { fileStem, runJson } from "../export";
import { AFRESH, inFlight, OUTCOME, PER_MILLION, PRICE, TOOL_LABEL } from "../labels";
import { factsOf, flowOf, gaugesOf, readingNow, spendOf, stateOf, walkOf, type Facts, type Gauge, type Line } from "../log";
import { changed } from "../options";
import { outcomeOf, type Run } from "../run";
import type { JsonReport } from "../types";
import { hashFor } from "../url";
import { basename, copy, cx, dollars, download, plural, secs, tokens, useTick } from "../util";
import { Action, Actions, Icon } from "./Icon";
import { Log } from "./Log";
import { MiddlePath } from "./Path";
import { Result, type Reader } from "./Result";
import { useToast } from "./Toast";

/** One colour a meaning: what jev read off the question, what was reused from before, and what the walk did. */
const TONE = {
  question: { chip: "bg-teal-50 ring-teal-600/20", dot: "bg-teal-600", says: "read off the question" },
  reused: { chip: "bg-violet-50 ring-violet-600/20", dot: "bg-violet-600", says: "reused from before" },
  walk: { chip: "bg-white ring-stone-200", dot: "bg-stone-400", says: "what the walk did" },
} as const;

function Fact({ label, children, tone }: { label: string; children: ReactNode; tone: keyof typeof TONE }) {
  return (
    <div className={cx("rounded-lg px-2.5 py-1.5 ring-1", TONE[tone].chip)}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className="text-xs font-medium text-stone-800">{children}</div>
    </div>
  );
}

/** What the log says jev read off the question and how the run went about it: one quiet line, opened into the details on a click. */
function FactLine({ f, kind }: { f: Facts; kind?: string }) {
  const [open, setOpen] = useState(false);
  const facts: { tone: keyof typeof TONE; label: string; short: string; body: ReactNode }[] = [
    ...(kind ? [{ tone: "question" as const, label: f.forced ? "kind (forced)" : "jev read it as", short: `${kind} question${f.forced ? " (forced)" : ""}`, body: `${kind} question` }] : []),
    ...(f.counts ? [{ tone: "question" as const, label: "counts", short: `counts ${f.counts}`, body: f.counts }] : []),
    ...(f.asks ? [{ tone: "question" as const, label: "asks for", short: `asks for ${f.asks}`, body: f.asks }] : []),
    ...(f.searches ? [{ tone: "question" as const, label: "searches the text for", short: `searches for ${f.searches}`, body: f.searches }] : []),
    ...(f.across ? [{ tone: "question" as const, label: "table across the shelf", short: `a table across the shelf`, body: `rows ${f.across.rows}; asks ${f.across.columns}` }] : []),
    ...(f.cache
      ? [
          {
            tone: "reused" as const,
            label: "ranking from the cache",
            short: f.cache.count > 1 ? `${f.cache.count} rankings reused` : `ranking reused (${f.cache.score})`,
            body: (
              <>
                {f.cache.count > 1 ? `${f.cache.count} rankings reused; the first from ` : ""}“{f.cache.question}”
                <span className="block font-normal text-stone-600">
                  match: {f.cache.score}. Ranking afresh costs up to about {AFRESH.toLocaleString("en-US")} tokens ({dollars((AFRESH * PER_MILLION) / 1e6)}) a PDF with a long outline.
                </span>
              </>
            ),
          },
        ]
      : []),
    ...(f.embedding ? [{ tone: "reused" as const, label: "embedding once", short: `embedding ${f.embedding}`, body: `${f.embedding}, kept for later questions` }] : []),
    ...(f.onlyOne ? [{ tone: "walk" as const, label: "passages", short: `one answer, not ${f.onlyOne}`, body: `asked for ${f.onlyOne}; a ${kind} question has one answer` }] : []),
    ...(f.sections !== undefined ? [{ tone: "walk" as const, label: "sections read", short: `${plural(f.sections, "section")} read`, body: String(f.sections) }] : []),
    ...(f.files !== undefined ? [{ tone: "walk" as const, label: "walked", short: `${plural(f.files, "file")}, ${plural(f.windows ?? 0, "window")}`, body: `${plural(f.files, "file")}, ${plural(f.windows ?? 0, "window")}` }] : []),
  ];
  if (facts.length === 0) return null;
  const tones = (Object.keys(TONE) as (keyof typeof TONE)[]).filter((t) => facts.some((x) => x.tone === t));
  return (
    <div className="text-xs">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-1.5 rounded-md px-1 py-0.5 text-left text-stone-600 hover:bg-stone-200/50">
        <Icon name="chevron" size={12} className={cx("mt-0.5 text-stone-500 transition-transform", open && "rotate-90")} />
        <span className="min-w-0 flex-1">
          {facts.map((x, i) => (
            <span key={x.label}>
              {i > 0 && <span aria-hidden="true" className="mx-1.5 text-stone-400">·</span>}
              <span className={cx("mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle", TONE[x.tone].dot)} />
              {x.short}
            </span>
          ))}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-2 pl-5">
          {tones.map((t) => (
            <div key={t}>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-stone-500">{TONE[t].says}</div>
              <div className="flex flex-wrap gap-2">
                {facts
                  .filter((x) => x.tone === t)
                  .map((x) => (
                    <Fact key={x.label} label={x.label} tone={t}>
                      {x.body}
                    </Fact>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const STATE: Record<ReturnType<typeof stateOf>, { tone: string; says: string }> = {
  take: { tone: "bg-emerald-100 text-emerald-800", says: "taken: its answer was kept" },
  keep: { tone: "bg-amber-100 text-amber-800", says: "kept: read, below the answer floor" },
  drop: { tone: "bg-rose-100 text-rose-700", says: "dropped: read, and it did not answer" },
  yes: { tone: "bg-emerald-50 text-emerald-700", says: "passed the gate, but the run ended before it was read out" },
  no: { tone: "text-stone-500", says: "the gate passed over it" },
  "reading…": { tone: "animate-pulse bg-sky-100 text-sky-800", says: "passed the gate or not gated yet; being read now" },
  "–": { tone: "text-stone-400", says: "the run ended before the gate reached it" },
};

/** The walk in a line, then each file opened and what was read in it with how it scored; while `live`, the read under way says so. */
function Walked({ lines, live }: { lines: Line[]; live: boolean }) {
  const [all, setAll] = useState(false);
  const w = walkOf(lines);
  // Nothing is "taken" yet while the walk may still take something.
  const flow = flowOf(w).filter((step) => !(live && step === "took nothing"));
  if (flow.length === 0) return null;
  const reads = w.files.reduce((n, f) => n + f.reads.length, 0);
  const last = w.files[w.files.length - 1]?.reads.at(-1);
  const shown = all ? Infinity : 8;
  let left = shown;
  return (
    <section className="rounded-2xl border border-stone-200 bg-white/70 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-stone-800">What was read</h3>
        <p className="text-xs text-stone-600">
          {flow.map((step, i) => (
            <span key={i}>
              {i > 0 && <span aria-hidden="true" className="mx-1 text-stone-400">→</span>}
              {step}
            </span>
          ))}
        </p>
      </div>
      {reads > 0 && (
        <ul className="mt-2 space-y-2">
          {w.files.map((f, i) => {
            const rows = f.reads.slice(0, Math.max(0, left));
            left -= rows.length;
            return (
              <li key={i}>
                {/* A table across the shelf opens files a cell at a time. */}
                {f.under && f.under !== w.files[i - 1]?.under && <div className="mt-1 mb-0.5 text-[11px] font-semibold text-stone-600">{f.under}</div>}
                {f.path && (
                  <div className="flex min-w-0 items-center gap-2 text-xs">
                    <MiddlePath path={f.path} className="font-medium text-stone-800" />
                    <span className="shrink-0 font-mono text-[11px] text-stone-500">score {f.score?.toFixed(2)}</span>
                  </div>
                )}
                {rows.length > 0 && (
                  <ul className={cx("divide-y divide-stone-100", f.path && "mt-0.5 border-l border-stone-200 pl-3")}>
                    {rows.map((r, j) => {
                      const state = stateOf(r, readingNow(r, live, r === last));
                      return (
                        <li key={j} className="flex min-w-0 items-baseline gap-2 py-1 text-xs">
                          <span title={STATE[state].says} className={cx("w-14 shrink-0 rounded px-1 text-center text-[10px] font-semibold", STATE[state].tone)}>
                            {state}
                          </span>
                          <span className="w-14 shrink-0 text-[11px] text-stone-500">{r.kind === "excerpt" ? "excerpt" : r.kind}</span>
                          <span className="min-w-0 flex-1 truncate text-stone-700" title={r.answer ? `${r.name}: ${r.answer}` : r.name}>
                            {r.name}
                            {r.answer && <span className="text-stone-500"> — “{r.answer}”</span>}
                          </span>
                          {r.p !== undefined && <span className="shrink-0 font-mono text-[11px] tabular-nums text-stone-500">p={r.p.toFixed(2)}</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {reads > 8 && (
        <button onClick={() => setAll((a) => !a)} className="mt-1 text-xs font-medium text-teal-700 hover:underline">
          {all ? "show fewer" : `show all ${reads}`}
        </button>
      )}
    </section>
  );
}

/**
 * A bar for a step the log can measure; the looping bar while there is
 * none. What counts against a cap is said in words, since a run that
 * answers early never fills it.
 */
function Progress({ gauges, trying }: { gauges: Gauge[]; trying: string }) {
  const bars = gauges.filter((g) => !g.cap);
  const caps = gauges.filter((g) => g.cap);
  return (
    <div className="space-y-2 rounded-2xl border border-sky-600/20 bg-sky-50/60 px-4 py-3">
      {caps.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-sky-900">
          {caps.map((g) => (
            <span key={g.label}>{g.label}</span>
          ))}
        </div>
      )}
      {bars.length === 0 ? (
        <div className="relative h-1 overflow-hidden rounded-full bg-sky-100">
          <div className="absolute inset-y-0 w-1/3 animate-[slide_1.2s_ease-in-out_infinite] rounded-full bg-sky-500" />
        </div>
      ) : (
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
          {bars.map((g) => (
            <div key={g.label}>
              <div className="mb-1 flex justify-between gap-2 text-[11px] text-sky-900">
                <span>{g.label}</span>
                <span className="font-mono tabular-nums">
                  {g.done}/{g.of}
                </span>
              </div>
              <div role="progressbar" aria-label={g.label} aria-valuemin={0} aria-valuemax={g.of} aria-valuenow={g.done} className="h-1.5 overflow-hidden rounded-full bg-sky-100">
                <div className="h-full rounded-full bg-sky-500 transition-[width]" style={{ width: `${(Math.min(g.done, g.of) / Math.max(1, g.of)) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="truncate font-mono text-[11px] text-sky-800">{trying}</div>
    </div>
  );
}

/** The answer's place before anything has come back, so the page does not jump when it does. */
function Skeleton() {
  return (
    <div aria-hidden="true" className="animate-pulse rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="mb-4 h-3 w-1/3 rounded bg-stone-200" />
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_200px]">
        <div className="space-y-2">
          <div className="h-8 w-24 rounded bg-stone-200" />
          <div className="h-3 w-2/3 rounded bg-stone-100" />
          <div className="h-3 w-1/2 rounded bg-stone-100" />
        </div>
        <div className="aspect-[3/4] rounded-lg bg-stone-100" />
      </div>
    </div>
  );
}

const PARTS = [
  { key: "jev", label: "waiting on jev", color: "bg-teal-600" },
  { key: "read", label: "reading PDFs", color: "bg-amber-500" },
  { key: "stdin", label: "reading paths", color: "bg-sky-500" },
  { key: "embed", label: "embedding for the cache", color: "bg-violet-500" },
  { key: "highlight", label: "marking the answer in a copy", color: "bg-yellow-400" },
  { key: "other", label: "everything else", color: "bg-stone-300" },
] as const;

function Timing({ spent }: { spent: JsonReport["spent"] }) {
  // The bar draws what the legend says: tenths of a second, so a part it calls 0.0s takes no width.
  const tenths = (k: (typeof PARTS)[number]["key"]) => Math.round((spent.ms[k] ?? 0) / 100);
  const drawn = PARTS.filter((p) => tenths(p.key) > 0);
  const total = Math.max(1, drawn.reduce((n, p) => n + tenths(p.key), 0));
  return (
    <div className="rounded-2xl border border-stone-200 bg-white/70 px-4 py-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-stone-800">Where the time and tokens went</h3>
        <span className="ml-auto font-mono text-xs tabular-nums text-stone-500">
          {secs(spent.ms.total)} · {spent.in.toLocaleString()} tokens in · {spent.out.toLocaleString()} out · {dollars(spent.dollars)}
        </span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-stone-100">
        {drawn.map((p) => (
          <div key={p.key} className={p.color} style={{ width: `${(tenths(p.key) / total) * 100}%` }} title={`${p.label} ${secs(spent.ms[p.key])}`} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-stone-500">
        {PARTS.filter((p) => tenths(p.key) > 0 || p.key === "jev").map((p) => (
          <span key={p.key} className="flex items-center gap-1.5">
            <span className={cx("h-2 w-2 rounded-sm", p.color)} />
            {p.label} <span className="font-mono tabular-nums text-stone-700">{secs(spent.ms[p.key])}</span>
          </span>
        ))}
        <span className="ml-auto text-stone-500">jev charges {PRICE}; output is free</span>
      </div>
    </div>
  );
}

/** The run's own settings, which may differ from the form's now: the options it changed and its command line. */
function RunSettings({ run }: { run: Run }) {
  const toast = useToast();
  const diff = changed(run.request.tool, run.request.options);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="text-stone-500">ran with</span>
      {diff.length === 0 && <span className="rounded-md bg-stone-200/60 px-1.5 py-0.5 text-stone-600">every option at its default</span>}
      {diff.map((d) => (
        <span key={d.key} className="rounded-md bg-teal-50 px-1.5 py-0.5 text-teal-900 ring-1 ring-teal-600/20" title={d.help}>
          {d.label} <span className="font-semibold">{String(run.request.options[d.key]) || "default"}</span>
        </span>
      ))}
      <Actions className="ml-auto">
        <Action icon="terminal" label="copy command" title={run.command} onClick={async () => toast((await copy(run.command)) ? "Command copied" : "Could not reach the clipboard", "ok")} />
        <Action
          icon="link"
          label="copy link"
          title="A link to this run; it opens only in this browser, since the history is kept here, not on the server"
          onClick={async () => toast((await copy(`${location.origin}${location.pathname}${hashFor(run.id)}`)) ? "Link copied. It opens this run only in this browser, which keeps the history" : "Could not reach the clipboard", "ok")}
        />
        {run.status !== "running" && (
          <Action
            icon="download"
            label="save JSON"
            title="Save the question, the answer and the log as one JSON file"
            onClick={() => {
              const name = `jev-${fileStem(run.request.question)}.json`;
              download(name, runJson(run), "application/json");
              toast(`Saved ${name}`);
            }}
          />
        )}
      </Actions>
    </div>
  );
}

type Props = { run: Run; reader: Reader; onStop: () => void; onPick: (path: string) => void; onRetry: (patch: Partial<Run["request"]["options"]>) => void; onEdit: () => void };

const STOP_SAYS = "Stop the run: calls that finished are counted; one still in flight is billed but not counted";

export function RunView({ run, reader, onStop, onPick, onRetry, onEdit }: Props) {
  const live = run.status === "running";
  const now = useTick(live);
  const [showPaths, setShowPaths] = useState(false);
  const outcome = outcomeOf(run);
  const o = OUTCOME[outcome];
  const spend = run.end?.report?.spent ?? { ...spendOf(run.lines), ms: undefined };
  const ms = live ? now - run.at : (run.end?.ms ?? 0);
  const f = factsOf(run.lines);
  const kind = run.end?.report?.kind ?? f.kind;
  const req = run.request;
  const flying = inFlight(run);
  const gauges = live ? gaugesOf(run.lines, run.trying, { max: req.options.max, maxFiles: req.tool === "jevfind" ? req.options.maxFiles : undefined }) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className={cx("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1", o.tone)}>
          <span className={cx("h-1.5 w-1.5 rounded-full", o.dot)} />
          {o.label}
        </span>
        <div className="min-w-0 flex-1 basis-48">
          <h2 className="line-clamp-2 font-serif text-lg leading-snug [overflow-wrap:anywhere] text-stone-900" title={req.question}>
            {req.question}
          </h2>
          <div className="text-xs text-stone-500">
            {TOOL_LABEL[req.tool]}
            {req.tool === "jevsec" && req.pdf ? (
              ` · ${basename(req.pdf)}`
            ) : req.paths ? (
              <>
                {" · "}
                <button onClick={() => setShowPaths((s) => !s)} aria-expanded={showPaths} className="text-stone-600 underline decoration-stone-300 underline-offset-2 hover:text-stone-900">
                  {req.paths.length} PDF{req.paths.length === 1 ? "" : "s"}
                </button>
              </>
            ) : (
              ""
            )}{" "}
            · {new Date(run.at).toLocaleTimeString()}
            {!live && (
              <button onClick={onEdit} className="ml-2 text-teal-700 hover:underline">
                ask again
              </button>
            )}
          </div>
        </div>
        {/* Under 640px the figures take a row of their own, so the question keeps the width. */}
        <div className="flex w-full items-center gap-4 font-mono text-xs tabular-nums text-stone-600 sm:w-auto">
          <span title="wall time">{secs(ms)}</span>
          <span title={`${spend.in.toLocaleString()} tokens in, ${spend.out.toLocaleString()} out`}>{tokens(spend.in)} tok</span>
          <span className="font-semibold text-stone-900">{dollars(spend.dollars)}</span>
          {flying && (
            <span className="font-sans text-amber-800" title="A call still in flight at the stop is billed by OpenRouter but never reported, so it is not in this count">
              + ≈1 call uncounted
            </span>
          )}
          {live && (
            <button onClick={onStop} title={STOP_SAYS} className="ml-auto rounded-lg bg-white px-2.5 py-1 font-sans text-xs font-semibold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50 sm:ml-0">
              Stop
            </button>
          )}
        </div>
      </div>

      {showPaths && req.paths && (
        <ul aria-label="The PDFs this run was given" className="scroll-thin max-h-48 overflow-y-auto rounded-xl border border-stone-200 bg-white/70 px-3 py-2 text-xs text-stone-700">
          {req.paths.map((p) => (
            <li key={p} className="py-0.5">
              <MiddlePath path={p} />
            </li>
          ))}
        </ul>
      )}

      <RunSettings run={run} />

      {live && <Progress gauges={gauges} trying={run.trying ?? run.lines[run.lines.length - 1]?.text ?? "starting…"} />}
      {live && run.lines.length === 0 && <Skeleton />}

      {!live && <Result run={run} reader={reader} onPick={onPick} onRetry={onRetry} onEdit={onEdit} />}
      <FactLine f={f} kind={kind} />
      <Walked lines={run.lines} live={live} />
      {!live && run.end?.report && <Timing spent={run.end.report.spent} />}
      <Log key={run.id} lines={run.lines} live={live} trying={run.trying} failed={outcome === "error"} />
    </div>
  );
}
