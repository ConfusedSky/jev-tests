import { useState } from "react";
import type { Run } from "../run";
import type { JsonHit, JsonReport, Ranked } from "../types";
import { basename, cx } from "../util";
import { PagePreview } from "./PagePreview";
import { Passage } from "./Passage";

/** A probability as a bar and its figure, green once it clears `floor`. */
export function Confidence({ p, floor, label }: { p: number; floor?: number; label: string }) {
  const ok = floor === undefined || p >= floor;
  return (
    <div className="flex items-center gap-2" title={`${label}: p=${p.toFixed(3)}${floor === undefined ? "" : `, floor ${floor}`}`}>
      <span className="text-[11px] text-stone-400">{label}</span>
      <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-stone-200">
        <div className={cx("h-full rounded-full", ok ? "bg-emerald-500" : "bg-amber-500")} style={{ width: `${Math.round(p * 100)}%` }} />
        {floor !== undefined && <div className="absolute top-0 h-full w-px bg-stone-500" style={{ left: `${floor * 100}%` }} />}
      </div>
      <span className="font-mono text-[11px] tabular-nums text-stone-600">{p.toFixed(2)}</span>
    </div>
  );
}

function Source({ hit }: { hit: JsonHit }) {
  const parts = hit.section.split(" > ");
  // A book without an outline names its windows by page, which the page already says.
  const named = !/^p\.\d+(-\d+)?$/.test(hit.section);
  return (
    <div className="min-w-0 text-xs text-stone-500">
      <span className="font-medium text-stone-700" title={hit.pdf}>
        {basename(hit.pdf)}
      </span>
      <span className="mx-1.5 text-stone-300">/</span>
      <span className="font-medium text-stone-700">p.{hit.page}</span>
      {named && (
        <>
          <span className="mx-1.5 text-stone-300">/</span>
          <span title={hit.section}>
            {parts.length > 2 && <span className="text-stone-400">{parts.slice(0, -1).join(" › ")} › </span>}
            {parts[parts.length - 1]}
          </span>
        </>
      )}
    </div>
  );
}

function Value({ kind, text }: { kind?: string; text: string }) {
  if (kind === "truth") {
    const yes = text.trim().toLowerCase() === "true";
    return <span className={cx("font-serif text-5xl font-semibold tracking-tight", yes ? "text-emerald-700" : "text-rose-700")}>{yes ? "True" : text === "false" ? "False" : text}</span>;
  }
  return <span className="font-serif text-5xl font-semibold tracking-tight break-words text-stone-900">{text}</span>;
}

function HitCard({ hit, kind, floor, stamp, index, count, below }: { hit: JsonHit; kind?: string; floor: number; stamp: string; index: number; count: number; below?: boolean }) {
  const a = hit.answer;
  const long = kind === "passage" || kind === "table";
  return (
    <article className={cx("overflow-hidden rounded-2xl border bg-white shadow-sm", below ? "border-amber-300" : "border-stone-200")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-stone-100 px-5 py-3">
        {count > 1 && <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] font-semibold text-stone-500">{index + 1} of {count}</span>}
        <Source hit={hit} />
        <div className="ml-auto flex items-center gap-4">
          {a && <Confidence p={a.p} floor={floor} label="answer" />}
          <Confidence p={hit.found} label="page" />
        </div>
      </div>
      <div className={cx("grid gap-6 p-5", long ? "lg:grid-cols-[minmax(0,1fr)_260px] xl:grid-cols-[minmax(0,1fr)_320px]" : "md:grid-cols-[minmax(0,1fr)_220px]")}>
        <div className="min-w-0">
          {!a ? (
            <p className="text-sm text-stone-500">This page passed the gate; nothing was read off it.</p>
          ) : long && a.passage ? (
            <Passage paras={a.passage} />
          ) : long ? (
            <p className="font-serif text-[15px] leading-relaxed whitespace-pre-wrap text-stone-800">{a.text}</p>
          ) : (
            <div>
              <Value kind={kind} text={a.text} />
              <div className="mt-2 text-xs text-stone-500">
                {kind === "count" ? "counted off the page" : kind === "number" ? "read off the page" : kind === "truth" ? "the statement, checked against the page" : ""}
                {a.pages && a.pages.length > 1 ? ` across pages ${a.pages.join(", ")}` : ""}
              </div>
            </div>
          )}
        </div>
        <PagePreview view={hit.view} pdf={hit.pdf} page={hit.page} stamp={stamp} compact />
      </div>
    </article>
  );
}

function Across({ table, floor, stamp }: { table: NonNullable<JsonReport["table"]>; floor: number; stamp: string }) {
  const [at, setAt] = useState<[number, number] | undefined>(() => {
    for (let i = 0; i < table.rows.length; i++) for (let j = 0; j < table.columns.length; j++) if (table.cells[i]![j]!.hit) return [i, j];
  });
  const cell = at && table.cells[at[0]]![at[1]]!;
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-stone-50">
              <th className="border-b border-stone-200 px-4 py-2.5 text-left text-xs font-semibold text-stone-500">document</th>
              {table.columns.map((c) => (
                <th key={c} className="border-b border-stone-200 px-4 py-2.5 text-left text-xs font-semibold text-stone-600">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={r}>
                <th className="border-b border-stone-100 px-4 py-2.5 text-left font-medium text-stone-800">{r}</th>
                {table.columns.map((c, j) => {
                  const x = table.cells[i]![j]!;
                  const on = at?.[0] === i && at?.[1] === j;
                  return (
                    <td key={c} className="border-b border-stone-100 p-1">
                      <button
                        onClick={() => setAt([i, j])}
                        title={x.why ?? `p=${x.hit?.answer?.p.toFixed(2)}`}
                        className={cx("w-full rounded-lg px-3 py-1.5 text-left", on ? "bg-teal-50 ring-1 ring-teal-600/30" : "hover:bg-stone-50", x.why ? "text-stone-400" : "text-stone-900")}
                      >
                        {x.text}
                        {x.why && <span className="block text-[11px] leading-snug">{x.why}</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cell?.hit && (
        <div>
          <div className="mb-2 text-xs text-stone-500">
            Where <span className="font-medium text-stone-700">{table.rows[at![0]]}</span> × <span className="font-medium text-stone-700">{table.columns[at![1]]}</span> was read, as a {cell.kind} question:
          </div>
          <HitCard hit={cell.hit} kind={cell.kind} floor={floor} stamp={stamp} index={0} count={1} below={!!cell.why} />
        </div>
      )}
    </div>
  );
}

function Names({ ranked, floor, onPick, onAll }: { ranked: Ranked[]; floor: number; onPick: (path: string) => void; onAll: () => void }) {
  if (ranked.length === 0)
    return (
      <Notice tone="stone" title={`No name reached the score floor of ${floor}`}>
        Reword the question, or see how every name scored.
        <button onClick={onAll} className="mt-3 block rounded-lg bg-stone-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-700">
          Rank every name, floor 0 (one call)
        </button>
      </Notice>
    );
  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 border-b border-stone-100 bg-stone-50 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
        <span>score 0–3</span>
        <span>file · why</span>
      </div>
      <ul>
        {ranked.map((r) => (
          <li key={r.name} className="group grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-4 border-b border-stone-100 px-5 py-2.5 last:border-0 hover:bg-stone-50">
            <div>
              <div className="font-mono text-sm font-semibold tabular-nums text-stone-800">{r.score.toFixed(2)}</div>
              <div className="relative mt-1 h-1 w-full rounded-full bg-stone-200">
                <div className="h-full rounded-full bg-teal-600" style={{ width: `${(r.score / 3) * 100}%` }} />
                <div className="absolute top-[-2px] h-2 w-px bg-stone-500" style={{ left: `${(floor / 3) * 100}%` }} title={`floor ${floor}`} />
              </div>
            </div>
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-stone-800" title={r.name}>
                  {basename(r.name)}
                </div>
                <div className="truncate text-xs text-stone-500">{r.reason}</div>
              </div>
              <button onClick={() => onPick(r.name)} className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-teal-700 opacity-0 group-hover:opacity-100 hover:bg-teal-50 focus:opacity-100">
                Ask this PDF →
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Notice({ tone, title, children }: { tone: "amber" | "rose" | "stone"; title: string; children?: React.ReactNode }) {
  const t = { amber: "border-amber-200 bg-amber-50 text-amber-900", rose: "border-rose-200 bg-rose-50 text-rose-900", stone: "border-stone-200 bg-white text-stone-800" }[tone];
  return (
    <div className={cx("rounded-2xl border px-5 py-4", t)}>
      <div className="text-sm font-semibold">{title}</div>
      {children && <div className="mt-1 text-sm opacity-80">{children}</div>}
    </div>
  );
}

export function Result({ run, onPick, onRetry }: { run: Run; onPick: (path: string) => void; onRetry: (patch: Partial<Run["request"]["options"]>) => void }) {
  const e = run.end;
  const o = run.request.options;
  if (!e) return null;
  if (e.ranked) return <Names ranked={e.ranked} floor={o.nameFloor} onPick={onPick} onAll={() => onRetry({ nameFloor: 0 })} />;
  const r = e.report;
  if (!r) {
    if (e.error === "stopped") return <Notice tone="stone" title="Stopped">The run was stopped; what it spent up to then is in the log.</Notice>;
    const cache = /--cache off/.test(e.error ?? "");
    return (
      <Notice tone="rose" title="The tool stopped before answering">
        <pre className="mt-1 font-mono text-xs whitespace-pre-wrap">{e.error}</pre>
        {cache && (
          <button onClick={() => onRetry({ cache: "off" })} className="mt-3 rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-600">
            Ask again with the cache off
          </button>
        )}
      </Notice>
    );
  }
  if (r.table) return <Across table={r.table} floor={o.answerFloor} stamp={run.id} />;
  if (r.status === "unanswered")
    return (
      <Notice tone="stone" title="No page answered">
        {r.message}
        <div className="mt-2 text-xs">
          Try rewording, a lower page threshold or answer floor in Options, or {run.request.tool === "jevsec" ? "the whole shelf" : "a larger max files"}.
        </div>
      </Notice>
    );
  return (
    <div className="space-y-4">
      {r.status === "below" && (
        <Notice tone="amber" title={`No answer reached the answer floor of ${o.answerFloor}`}>
          The best one read is below; treat it as a lead, not an answer.
        </Notice>
      )}
      {r.hits.map((h, i) => (
        <HitCard key={i} hit={h} kind={r.kind} floor={o.answerFloor} stamp={run.id} index={i} count={r.hits.length} below={r.status === "below"} />
      ))}
    </div>
  );
}
