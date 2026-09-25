import { useState } from "react";
import { acrossGrid, answerText, fileStem } from "../export";
import { factsOf, withoutCost, type Facts } from "../log";
import type { Options, Tool } from "../options";
import type { Run } from "../run";
import type { JsonHit, JsonReport, Ranked } from "../types";
import { basename, copy, cx } from "../util";
import { GridExport } from "./GridExport";
import { PagePreview } from "./PagePreview";
import { Passage } from "./Passage";
import { useToast } from "./Toast";

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

const MARKED: Record<string, string> = {
  count: "each name counted is marked on its page",
  number: "the figure is marked where it stands",
  truth: "a statement rests on no single line, so nothing is marked",
};

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 border-t border-stone-100 py-2 text-xs">
      <dt className="text-stone-400">{label}</dt>
      <dd className="min-w-0 text-stone-700">{children}</dd>
    </div>
  );
}

type Card = { hit: JsonHit; kind?: string; floor: number; stamp: string; index: number; count: number; below?: boolean; reading?: string; contents?: boolean; stem?: string };

/** Where a count or figure came from: the page it stands on, or the table of contents, which lists the entries without a page to mark. */
const FROM = {
  page: { count: "counted off the page", number: "read off the page", truth: "the statement, checked against the page" } as Record<string, string>,
  contents: { count: "counted off the table of contents", number: "read off the table of contents" } as Record<string, string>,
};

function HitCard({ hit, kind, floor, stamp, index, count, below, reading, contents, stem }: Card) {
  const a = hit.answer;
  const toast = useToast();
  const long = kind === "passage" || kind === "table";
  return (
    <article className={cx("overflow-hidden rounded-2xl border bg-white shadow-sm", below ? "border-amber-300" : "border-stone-200")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-stone-100 px-5 py-3">
        {count > 1 && <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] font-semibold text-stone-500">{index + 1} of {count}</span>}
        <Source hit={hit} />
        <div className="ml-auto flex items-center gap-4">
          {a && <Confidence p={a.p} floor={floor} label="answer" />}
          <Confidence p={hit.found} label="page" />
          {a && (
            <button
              onClick={async () => toast((await copy(answerText(hit))) ? "Answer copied, with where it stands" : "Could not reach the clipboard", "ok")}
              title="Copy the answer with the book, page and section"
              className="rounded-md px-1.5 py-0.5 text-[11px] text-stone-500 hover:bg-stone-100 hover:text-stone-800"
            >
              copy
            </button>
          )}
        </div>
      </div>
      <div className={cx("grid gap-6 p-5", long ? "lg:grid-cols-[minmax(0,1fr)_260px] xl:grid-cols-[minmax(0,1fr)_320px]" : "md:grid-cols-[minmax(0,1fr)_200px]")}>
        <div className="min-w-0">
          {!a ? (
            <p className="text-sm text-stone-500">This page passed the gate; nothing was read off it.</p>
          ) : long && a.passage ? (
            <Passage paras={a.passage} stem={stem} />
          ) : long ? (
            <p className="font-serif text-[15px] leading-relaxed whitespace-pre-wrap text-stone-800">{a.text}</p>
          ) : (
            <div>
              <Value kind={kind} text={a.text} />
              <div className="mt-1 mb-4 text-sm text-stone-500">
                {(contents ? FROM.contents : FROM.page)[kind ?? ""] ?? ""}
                {a.pages && a.pages.length > 1 ? ` across pages ${a.pages.join(", ")}` : ""}
              </div>
              <dl>
                {reading && <Detail label="jev read it as">{reading}</Detail>}
                <Detail label="found in">
                  <span className="font-medium">{basename(hit.pdf)}</span>, p.{hit.page}
                  {!/^p\.\d+(-\d+)?$/.test(hit.section) && <span className="block text-stone-500">{hit.section.split(" > ").join(" › ")}</span>}
                </Detail>
                <Detail label="how sure">
                  answer p={a.p.toFixed(2)} {a.p >= floor ? `clears the answer floor ${floor}` : `is under the answer floor ${floor}`}; the page passed the gate at p={hit.found.toFixed(2)}
                </Detail>
                <Detail label="on the page">
                  {contents
                    ? "nothing is marked: the contents list the section's entries, and the page shown is where the section starts"
                    : hit.view !== hit.pdf
                      ? (MARKED[kind ?? ""] ?? "marked in a copy")
                      : kind === "truth"
                        ? MARKED.truth
                        : "not marked: the text was not found on the page's lines, or highlighting is off"}
                </Detail>
              </dl>
            </div>
          )}
        </div>
        <PagePreview view={hit.view} pdf={hit.pdf} page={hit.page} stamp={stamp} compact />
      </div>
    </article>
  );
}

function Across({ table, floor, stamp, stem, contents }: { table: NonNullable<JsonReport["table"]>; floor: number; stamp: string; stem: string; contents: (hit: JsonHit) => boolean }) {
  const [at, setAt] = useState<[number, number] | undefined>(() => {
    for (let i = 0; i < table.rows.length; i++) for (let j = 0; j < table.columns.length; j++) if (table.cells[i]![j]!.hit) return [i, j];
  });
  const cell = at && table.cells[at[0]]![at[1]]!;
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-stone-100 px-4 py-2 text-xs text-stone-500">
          <span>
            {table.rows.length} document{table.rows.length === 1 ? "" : "s"} × {table.columns.length} question{table.columns.length === 1 ? "" : "s"}; click a cell to see where it was read
          </span>
          <span className="ml-auto">
            <GridExport grid={acrossGrid(table)} stem={stem} />
          </span>
        </div>
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
          <HitCard hit={cell.hit} kind={cell.kind} floor={floor} stamp={stamp} index={0} count={1} below={!!cell.why} contents={contents(cell.hit)} stem={stem} />
        </div>
      )}
    </div>
  );
}

/** Fewer passages than asked for: what the walk read, what stopped it, and the retry that would go on, each read off the log. */
function Short({ got, f, o, tool, onRetry }: { got: number; f: Facts; o: Options; tool: Tool; onRetry: (patch: Partial<Options>) => void }) {
  const atMax = (f.mostSections ?? 0) >= o.max || (f.scan !== undefined && f.scan.read >= o.max && f.scan.of > f.scan.read);
  const n = (k: number, what: string) => `${k} ${what}${k === 1 ? "" : "s"}`;
  const read = [f.sections ? n(f.sections, "section") : "", f.scan ? n(f.scan.read, "window") : ""].filter(Boolean).join(" and ");
  const files = tool === "jevfind" && f.filesBelow ? f.filesBelow : 0;
  const button = "rounded-lg bg-stone-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-700";
  return (
    <Notice tone="stone" title={`${got} of the ${o.hits} passages asked for`}>
      {read ? `The walk read ${read} and found no more that answered.` : "Nothing more was read."}
      {atMax && ` It stopped at the max of ${o.max} sections per file; reading further costs more calls.`}
      {!atMax && f.titleBelow ? ` ${n(f.titleBelow, "section")} scored below the title floor ${o.titleFloor}, which the walk reads only while nothing has answered.` : ""}
      {files ? ` ${n(files, "file")} scored below the file floor ${o.fileFloor} and stayed shut.` : ""}
      <div className="mt-3 flex flex-wrap gap-2">
        {atMax && (
          <button onClick={() => onRetry({ max: o.max * 2 })} className={button}>
            Ask again, reading up to {o.max * 2} sections
          </button>
        )}
        {!atMax && f.titleBelow ? (
          <button onClick={() => onRetry({ titleFloor: 0 })} className={button}>
            Ask again, reading below the title floor
          </button>
        ) : null}
        {files ? (
          <button onClick={() => onRetry({ fileFloor: 0 })} className={button}>
            Ask again, opening files below the file floor
          </button>
        ) : null}
      </div>
    </Notice>
  );
}

function Names({ ranked, total, floor, onPick, onAll }: { ranked: Ranked[]; total: number; floor: number; onPick: (path: string) => void; onAll: () => void }) {
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
      <div className="flex items-center gap-3 border-b border-stone-100 px-5 py-2.5 text-xs text-stone-500">
        <span>
          <span className="font-semibold text-stone-800">{ranked.length}</span> of {total} names reached the score floor {floor}
        </span>
        {total > ranked.length && floor > 0 && (
          <button onClick={onAll} className="ml-auto rounded-md px-2 py-1 font-medium text-teal-700 hover:bg-teal-50">
            rank every name, floor 0
          </button>
        )}
      </div>
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
  const f = factsOf(run.lines);
  const reading = f.kind === "count" && f.counts ? `a count of ${f.counts}` : f.kind === "number" && f.asks ? `a figure: ${f.asks}` : f.kind ? `a ${f.kind} question` : undefined;
  // A hit the contents answered names the section and the answer the log's toc line does.
  const contents = (hit: JsonHit) => f.toc?.some((t) => t.section === hit.section && t.text === hit.answer?.text) ?? false;
  const stem = fileStem(run.request.question);
  if (e.ranked) return <Names ranked={e.ranked} total={run.request.paths?.length ?? 0} floor={o.nameFloor} onPick={onPick} onAll={() => onRetry({ nameFloor: 0 })} />;
  const r = e.report;
  if (!r) {
    if (e.error === "stopped")
      return (
        <Notice tone="stone" title="Stopped">
          The log counts every call that finished before the stop. A call still in flight is billed by OpenRouter but never reported back, so it is not in that count.
        </Notice>
      );
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
  if (r.table) return <Across table={r.table} floor={o.answerFloor} stamp={run.id} stem={stem} contents={contents} />;
  if (r.status === "unanswered") {
    if (run.request.tool === "jevsec" && f.noText?.length)
      return (
        <Notice tone="amber" title={f.noText.length === 1 ? `${basename(f.noText[0]!)} has no text to read` : `${f.noText.length} PDFs have no text to read`}>
          It has neither an outline nor a text layer, so it is most likely scanned pages. jev reads text, so nothing in it can be searched until it has been through OCR (for example with ocrmypdf).
        </Notice>
      );
    return (
      <Notice tone="stone" title="No page answered">
        {r.message && withoutCost(r.message)}
        <div className="mt-2 text-xs">
          Try rewording, a lower page threshold or answer floor in Options, or {run.request.tool === "jevsec" ? "the whole shelf" : "a larger max files"}. The log shows every page that was read and how it scored.
        </div>
        {f.noText?.length ? <div className="mt-2 text-xs">Skipped for having no text layer (scanned pages?): {f.noText.map(basename).join(", ")}.</div> : null}
      </Notice>
    );
  }
  const short = r.kind === "passage" && r.status === "answered" && r.hits.length < o.hits;
  return (
    <div className="space-y-4">
      {r.status === "below" && (
        <Notice tone="amber" title={`No answer reached the answer floor of ${o.answerFloor}`}>
          The best one read is below; treat it as a lead, not an answer.
        </Notice>
      )}
      {short && <Short got={r.hits.length} f={f} o={o} tool={run.request.tool} onRetry={onRetry} />}
      {r.hits.map((h, i) => (
        <HitCard key={i} hit={h} kind={r.kind} floor={o.answerFloor} stamp={run.id} index={i} count={r.hits.length} below={r.status === "below"} reading={reading} contents={contents(h)} stem={stem} />
      ))}
    </div>
  );
}
