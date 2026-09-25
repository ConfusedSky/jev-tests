import { fileStem, runJson } from "../export";
import { OUTCOME, TOOL_LABEL } from "../labels";
import { factsOf, spendOf } from "../log";
import { changed } from "../options";
import { outcomeOf, type Run } from "../run";
import type { JsonReport } from "../types";
import { basename, copy, cx, dollars, download, secs, tokens, useTick } from "../util";
import { Log } from "./Log";
import { Result } from "./Result";
import { useToast } from "./Toast";

function Fact({ label, children, tone = "stone" }: { label: string; children: React.ReactNode; tone?: "stone" | "teal" | "violet" }) {
  const t = { stone: "bg-white ring-stone-200", teal: "bg-teal-50 ring-teal-600/20", violet: "bg-violet-50 ring-violet-600/20" }[tone];
  return (
    <div className={cx("rounded-lg px-2.5 py-1.5 ring-1", t)}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">{label}</div>
      <div className="text-xs font-medium text-stone-800">{children}</div>
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
    <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
      <div className="mb-2 flex items-baseline gap-3">
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
        <span className="ml-auto text-stone-400">jev charges $0.042 per million tokens in; output is free</span>
      </div>
    </div>
  );
}

/** The run's own settings, which may differ from the form's now: the options it changed and its command line. */
function RunSettings({ run }: { run: Run }) {
  const toast = useToast();
  const diff = changed(run.request.tool, run.request.options);
  const link = "rounded-md px-1.5 py-0.5 text-stone-500 hover:bg-stone-200/60 hover:text-stone-800";
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="text-stone-400">ran with</span>
      {diff.length === 0 && <span className="rounded-md bg-stone-200/60 px-1.5 py-0.5 text-stone-600">every option at its default</span>}
      {diff.map((d) => (
        <span key={d.key} className="rounded-md bg-teal-50 px-1.5 py-0.5 text-teal-900 ring-1 ring-teal-600/20" title={d.help}>
          {d.label} <span className="font-semibold">{String(run.request.options[d.key]) || "default"}</span>
        </span>
      ))}
      <span className="ml-auto flex gap-0.5">
        <button onClick={async () => toast((await copy(run.command)) ? "Command copied" : "Could not reach the clipboard", "ok")} title={run.command} className={cx(link, "font-mono")}>
          $ copy command
        </button>
        {run.status !== "running" && (
          <button
            onClick={() => {
              const name = `jev-${fileStem(run.request.question)}.json`;
              download(name, runJson(run), "application/json");
              toast(`Saved ${name}`);
            }}
            title="Save the question, the answer and the log as one JSON file"
            className={link}
          >
            save JSON
          </button>
        )}
      </span>
    </div>
  );
}

type Props = { run: Run; onStop: () => void; onPick: (path: string) => void; onRetry: (patch: Partial<Run["request"]["options"]>) => void; onEdit: () => void };

export function RunView({ run, onStop, onPick, onRetry, onEdit }: Props) {
  const live = run.status === "running";
  const now = useTick(live);
  const outcome = outcomeOf(run);
  const o = OUTCOME[outcome];
  const spend = run.end?.report?.spent ?? { ...spendOf(run.lines), ms: undefined };
  const ms = live ? now - run.at : (run.end?.ms ?? 0);
  const f = factsOf(run.lines);
  const kind = run.end?.report?.kind ?? f.kind;
  const req = run.request;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1", o.tone)}>
          <span className={cx("h-1.5 w-1.5 rounded-full", o.dot)} />
          {o.label}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-serif text-lg text-stone-900" title={req.question}>
            {req.question}
          </div>
          <div className="text-xs text-stone-500">
            {TOOL_LABEL[req.tool]}
            {req.tool === "jevsec" && req.pdf ? ` · ${basename(req.pdf)}` : req.paths ? ` · ${req.paths.length} PDFs` : ""} · {new Date(run.at).toLocaleTimeString()}
            {!live && (
              <button onClick={onEdit} className="ml-2 text-teal-700 hover:underline">
                ask again
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 font-mono text-xs tabular-nums text-stone-600">
          <span title="wall time">{secs(ms)}</span>
          <span title={`${spend.in.toLocaleString()} tokens in, ${spend.out.toLocaleString()} out`}>{tokens(spend.in)} tok</span>
          <span className="font-semibold text-stone-900">{dollars(spend.dollars)}</span>
          {live && (
            <button onClick={onStop} className="rounded-lg bg-white px-2.5 py-1 font-sans text-xs font-semibold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50">
              Stop
            </button>
          )}
        </div>
      </div>

      <RunSettings run={run} />

      {live && (
        <div className="space-y-1.5">
          <div className="relative h-1 overflow-hidden rounded-full bg-sky-100">
            <div className="absolute inset-y-0 w-1/3 animate-[slide_1.2s_ease-in-out_infinite] rounded-full bg-sky-500" />
          </div>
          <div className="truncate font-mono text-[11px] text-sky-800">{run.trying ?? run.lines[run.lines.length - 1]?.text ?? "starting…"}</div>
        </div>
      )}

      {(kind || f.searches || f.cache || f.across || f.embedding || f.files !== undefined) && (
        <div className="flex flex-wrap gap-2">
          {kind && (
            <Fact label={f.forced ? "kind (forced)" : "jev read it as"} tone="teal">
              {kind} question
            </Fact>
          )}
          {f.counts && <Fact label="counts">{f.counts}</Fact>}
          {f.asks && <Fact label="asks for">{f.asks}</Fact>}
          {f.searches && <Fact label="searches the text for">{f.searches}</Fact>}
          {f.across && (
            <Fact label="table across the shelf" tone="violet">
              rows {f.across.rows}; asks {f.across.columns}
            </Fact>
          )}
          {f.cache && (
            <Fact label="ranking from cache" tone="violet">
              {f.cache.count > 1 ? (
                <span title={`first: “${f.cache.question}” (${f.cache.score})`}>{f.cache.count} rankings reused</span>
              ) : (
                <span title={f.cache.score}>“{f.cache.question}”</span>
              )}
            </Fact>
          )}
          {f.embedding && <Fact label="embedding once">{f.embedding}</Fact>}
          {f.onlyOne && <Fact label="passages">asked for {f.onlyOne}; a {kind} question has one answer</Fact>}
          {f.sections !== undefined && <Fact label="sections read">{f.sections}</Fact>}
          {f.files !== undefined && (
            <Fact label="walked">
              {f.files} files, {f.windows} windows
            </Fact>
          )}
        </div>
      )}

      {!live && <Result run={run} onPick={onPick} onRetry={onRetry} />}
      {!live && run.end?.report && <Timing spent={run.end.report.spent} />}
      <Log key={run.id} lines={run.lines} live={live} trying={run.trying} />
    </div>
  );
}
