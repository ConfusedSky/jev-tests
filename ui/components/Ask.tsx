import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { changed, commandFor, DEFAULTS, invalid, SPECS, type Options, type Spec, type Tool } from "../options";
import type { ShelfFile } from "../types";
import { copy, cx } from "../util";
import { Action, Icon } from "./Icon";
import { PdfPicker } from "./PdfPicker";
import { useToast } from "./Toast";

const MODES: { tool: Tool; label: string; asks: string; cost: string }[] = [
  { tool: "jevfind", label: "Whole shelf", asks: "Which page of which PDF answers it?", cost: "ranks the paths, then reads the best files" },
  { tool: "jevsec", label: "One PDF", asks: "Which page of this PDF answers it?", cost: "ranks its sections, then reads the best pages" },
  { tool: "jevgrep", label: "File names", asks: "Which filenames could answer it?", cost: "names only, one call, reads no file" },
];

/** How the wording picks the kind of answer; jev reads it, --kind forces it. `template` starts a question of the kind, its gap to fill marked "…". */
export const KIND_HINTS = [
  { kind: "count", says: "How many … are there?", template: "How many … are there?", gives: "a number, counted off the list" },
  { kind: "number", says: "How much does … cost?", template: "How much does … cost?", gives: "a figure read off the page" },
  { kind: "truth", says: "A statement to check", template: "Is it true that …?", gives: "true or false; a plain statement works too" },
  { kind: "passage", says: "How do I …?", template: "How do I …?", gives: "the sentences that answer, or the rows of a table the page prints" },
  { kind: "table", says: "Make a table of … with …", template: "Make a table of … with columns …", gives: "a table built to the question" },
  { kind: "across", says: "A table with … and … as rows", template: "Give me a table with … and … as rows, and ask …", gives: "a row per document named, a column per question; whole shelf only" },
] as const;

/** Why the question cannot be asked yet, or undefined when it can; `files` is the shelf's, which says whether the PDF picked is empty. */
export function whyBlocked(a: { tool: Tool; question: string; options: Options; pdf?: string; files: ShelfFile[]; cacheWhy?: string; offline?: boolean }): string | undefined {
  if (a.offline) return "The UI server is not running";
  // Said before a question is typed, since the tools would spend a call on it before finding it empty.
  if (a.tool === "jevsec" && a.pdf && a.files.find((f) => f.path === a.pdf)?.size === 0) return "This file is empty";
  if (!a.question.trim()) return "Type a question";
  if (a.tool === "jevsec" && !a.pdf) return "Pick a PDF to ask";
  if (a.tool !== "jevsec" && a.files.length === 0) return "Add a folder or a locate command to the shelf";
  return invalid(a.tool, a.options) ?? (a.cacheWhy ? "The ranking cache can't run" : undefined);
}

type Props = {
  tool: Tool;
  setTool: (t: Tool) => void;
  question: string;
  setQuestion: (q: string) => void;
  options: Options;
  setOptions: (o: Options) => void;
  pdf?: string;
  onPickPdf: (path: string) => void;
  /** Opens the sidebar on the shelf, to add a source to it. */
  onShowShelf: () => void;
  folders: string[];
  files: ShelfFile[];
  running: boolean;
  offline: boolean;
  onAsk: () => void;
  onStop: () => void;
  /** A line to show under the question, like what "ask again" restored. */
  note?: string;
  onDismissNote: () => void;
  /** A new one moves the cursor into the question, selecting `select` in it when given, or all of it for true. */
  focus: { n: number; select?: string | true };
  /** Why the chosen ranking cache cannot run, when it cannot. */
  cacheWhy?: string;
  onCacheOffOnce: () => void;
  /** Earlier questions like the one being typed, offered while the box has focus. */
  suggestions: string[];
  /** Starts a question from a kind's example. */
  onExample: (template: string) => void;
};

export function Ask(props: Props) {
  const { tool, setTool, question, setQuestion, options, setOptions, pdf, onPickPdf, onShowShelf, folders, files, running, offline, onAsk, onStop, note, onDismissNote, focus, cacheWhy, onCacheOffOnce, suggestions, onExample } = props;
  const [showOptions, setShowOptions] = useState(false);
  // Focus is in the question or among the earlier questions under it, which stay while it moves between them.
  const [within, setWithin] = useState(false);
  const toast = useToast();
  const box = useRef<HTMLTextAreaElement>(null);
  const diff = changed(tool, options);
  const mode = MODES.find((m) => m.tool === tool)!;
  const blocked = whyBlocked({ tool, question, options, pdf, files, cacheWhy, offline });
  const command = commandFor(tool, options, question.trim(), { pdf, sources: folders });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [question]);

  // Asking puts the answer in view, so the options fold away.
  useEffect(() => {
    if (running) setShowOptions(false);
  }, [running]);

  useEffect(() => {
    const el = box.current;
    if (!focus.n || !el) return;
    el.focus();
    if (focus.select === true) return el.select();
    const at = focus.select ? el.value.indexOf(focus.select) : -1;
    if (at >= 0) el.setSelectionRange(at, at + focus.select!.length);
  }, [focus]);

  /** Arrow keys move along a row of chips, one Tab stop for the row; up goes back to the question. */
  const chipKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = [...e.currentTarget.querySelectorAll<HTMLElement>("button")];
    const i = all.indexOf(document.activeElement as HTMLElement);
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: -1, Home: 0, End: all.length - 1 }[e.key];
    if (i < 0 || to === undefined) return;
    e.preventDefault();
    if (to < 0) box.current?.focus();
    else all[Math.min(to, all.length - 1)]?.focus();
  };

  return (
    <section data-ask className="rounded-2xl border border-stone-200 bg-white shadow-sm transition-shadow has-[textarea:focus]:border-teal-600/40 has-[textarea:focus]:ring-4 has-[textarea:focus]:ring-teal-600/10">
      <div className="flex flex-wrap items-center gap-3 border-b border-stone-100 px-4 pt-3 pb-3">
        <div role="tablist" aria-label="What to search" className="flex rounded-xl bg-stone-100 p-1">
          {MODES.map((m) => (
            <button
              key={m.tool}
              role="tab"
              aria-selected={m.tool === tool}
              onClick={() => setTool(m.tool)}
              className={cx("rounded-lg px-3 py-1.5 text-sm font-medium transition", m.tool === tool ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800")}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="min-w-0 text-xs leading-snug text-stone-500">
          <div className="font-medium text-stone-700">{mode.asks}</div>
          <div>
            {tool === "jevsec" ? (
              <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                in
                <PdfPicker
                  files={files}
                  pdf={pdf}
                  onPick={(p) => {
                    onPickPdf(p);
                    box.current?.focus();
                  }}
                  onShowShelf={onShowShelf}
                />
                <span>{pdf ? mode.cost : "to ask it alone"}</span>
              </span>
            ) : (
              <span>
                {files.length} PDF{files.length === 1 ? "" : "s"} on the shelf; {mode.cost}
              </span>
            )}
          </div>
        </div>
      </div>

      <div onFocus={() => setWithin(true)} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setWithin(false)}>
        <div className="px-4 pt-3">
          <textarea
            ref={box}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!running && !blocked) onAsk();
              }
              if (e.key === "Escape" && running) onStop();
              // Down from the end of the question goes on to the earlier ones; anywhere else it moves the cursor.
              const el = e.currentTarget;
              if (e.key === "ArrowDown" && !e.shiftKey && el.selectionStart === el.value.length && el.selectionEnd === el.value.length) {
                const chip = el.closest("[data-ask]")?.querySelector<HTMLElement>("[data-chip]");
                if (chip) {
                  e.preventDefault();
                  chip.focus();
                }
              }
            }}
            rows={2}
            placeholder={tool === "jevgrep" ? "What are you looking for? jev ranks the filenames against it" : "Ask a question, or state something to check"}
            aria-label="Question"
            aria-describedby={within && suggestions.length > 0 ? "ask-earlier-hint" : undefined}
            className="w-full resize-none border-0 bg-transparent font-serif text-lg leading-snug text-stone-900 placeholder:text-stone-500 focus:outline-none"
          />
        </div>

        {within && suggestions.length > 0 && (
          <div role="group" aria-label="Earlier questions" onKeyDown={chipKeys} className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
            <span id="ask-earlier-hint" className="mr-1 text-[11px] font-medium uppercase tracking-wide text-stone-500">
              {question.trim() ? "asked before" : "recent"}
              <span className="sr-only">: press down to reach them</span>
            </span>
            {suggestions.map((s, i) => (
              <button
                key={s}
                data-chip
                // One stop for Tab; the arrow keys move along the rest.
                tabIndex={i === 0 ? 0 : -1}
                // Pressing must not blur the box, or the row goes before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setQuestion(s);
                  box.current?.focus();
                }}
                className="max-w-full truncate rounded-full bg-stone-50 px-2.5 py-0.5 font-serif text-xs text-stone-700 ring-1 ring-stone-200 hover:bg-teal-50 hover:ring-teal-600/30"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {tool !== "jevgrep" && (
        <div role="group" aria-label="Kinds of answer: pick one to start a question from its example" onKeyDown={chipKeys} className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-stone-500">{options.kind === "auto" ? "the wording picks the answer" : "kind forced in Options"}</span>
          {KIND_HINTS.filter((k) => k.kind !== "across" || tool === "jevfind").map((k, i) => {
            const forced = k.kind === "across" ? options.across === "on" : options.kind === k.kind;
            return (
              <button
                key={k.kind}
                tabIndex={i === 0 ? 0 : -1}
                onClick={() => onExample(k.template)}
                title={`Start from “${k.template}”: ${k.gives}`}
                className={cx(
                  "rounded-full px-2 py-0.5 text-left text-[11px] ring-1",
                  forced ? "bg-teal-700 text-white ring-teal-700" : "bg-stone-50 text-stone-700 ring-stone-200 hover:bg-teal-50 hover:ring-teal-600/30",
                )}
              >
                <span className="font-semibold">{k.kind}</span> <span className={cx("font-serif", forced ? "text-teal-100" : "text-stone-500")}>{k.says}</span>
              </button>
            );
          })}
        </div>
      )}

      {note && (
        <div className="mx-4 mb-2 flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-1.5 text-xs text-sky-900 ring-1 ring-sky-600/20">
          <span className="flex-1">{note}</span>
          <button onClick={onDismissNote} aria-label="Dismiss" className="text-sky-700 hover:text-sky-900">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {cacheWhy && (
        <div role="alert" className="mx-4 mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-600/20">
          <div>
            <span className="font-semibold">The ranking cache can't run, so the tool would refuse this question.</span> {cacheWhy.replace(/^the ranking cache \(--cache [^)]+\) /, "It ")}
          </div>
          <div className="mt-1.5 flex gap-2">
            <button onClick={onCacheOffOnce} disabled={running || !question.trim()} className="rounded-md bg-amber-700 px-2 py-1 font-semibold text-white hover:bg-amber-600 disabled:opacity-40">
              Ask once with the cache off
            </button>
            <button onClick={() => setOptions({ ...options, cache: "off" })} className="rounded-md px-2 py-1 font-medium text-amber-800 ring-1 ring-amber-600/30 hover:bg-amber-100">
              Turn the cache off
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-stone-100 px-4 py-2.5">
        <button
          onClick={() => setShowOptions((s) => !s)}
          aria-expanded={showOptions}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
        >
          <Icon name="chevron" size={12} className={cx("text-stone-500 transition-transform", showOptions && "rotate-90")} />
          Options
          {diff.length > 0 && <span className="rounded-full bg-teal-100 px-1.5 text-[11px] font-semibold text-teal-800">{diff.length} changed</span>}
        </button>
        {diff.length > 0 && !showOptions && (
          <div className="hidden min-w-0 flex-1 truncate text-xs text-stone-500 lg:block">{diff.map((s) => `${s.label}: ${String(options[s.key])}`).join(" · ")}</div>
        )}
        <div className="ml-auto flex items-center gap-3">
          {!running && blocked && <span className={cx("text-xs", blocked === "Type a question" ? "text-stone-500" : offline ? "font-medium text-rose-700" : "font-medium text-amber-700")}>{blocked}</span>}
          {running ? (
            <button onClick={onStop} title="Stop the run: calls that finished are counted; one still in flight is billed but not counted" className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-500">
              Stop <kbd className="ml-1 text-[10px] font-normal text-rose-200">esc</kbd>
            </button>
          ) : (
            <button
              onClick={onAsk}
              disabled={!!blocked}
              className="group rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500 disabled:shadow-none"
            >
              Ask <kbd className="ml-1 text-[10px] font-normal text-teal-200 group-disabled:text-stone-500">⏎</kbd>
            </button>
          )}
        </div>
      </div>

      {showOptions && <OptionsPanel tool={tool} options={options} setOptions={setOptions} />}

      <div className="flex items-start gap-2 rounded-b-2xl border-t border-stone-100 bg-stone-50 px-4 py-2">
        <span className="shrink-0 font-mono text-[11px] text-stone-500">$</span>
        <code className="min-w-0 flex-1 font-mono text-[11px] [overflow-wrap:anywhere] text-stone-600" title="The same run from a terminal in the repo">
          {command}
        </code>
        <Action icon="copy" label="copy" title="Copy the command" onClick={async () => toast((await copy(command)) ? "Command copied" : "Could not reach the clipboard", "ok")} />
      </div>
    </section>
  );
}

function OptionsPanel({ tool, options, setOptions }: { tool: Tool; options: Options; setOptions: (o: Options) => void }) {
  const specs = SPECS.filter((s) => s.tools.includes(tool));
  const set = (key: keyof Options, v: Options[keyof Options]) => setOptions({ ...options, [key]: v });
  const groups = [
    { title: "Common", specs: specs.filter((s) => !s.advanced) },
    { title: "Walk and floors", specs: specs.filter((s) => s.advanced) },
  ].filter((g) => g.specs.length);
  return (
    <div className="border-t border-stone-100 bg-stone-50/60 px-4 py-3">
      {groups.map((g) => (
        <div key={g.title} className="mb-3 last:mb-0">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">{g.title}</div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2 xl:grid-cols-3">
            {g.specs.map((s) => (
              <Field key={s.key} spec={s} value={options[s.key]} onChange={(v) => set(s.key, v)} />
            ))}
          </div>
        </div>
      ))}
      <button onClick={() => setOptions({ ...DEFAULTS })} className="mt-1 text-xs text-teal-700 hover:underline">
        Reset every option to its default
      </button>
    </div>
  );
}

function Field({ spec, value, onChange }: { spec: Spec; value: Options[keyof Options]; onChange: (v: Options[keyof Options]) => void }) {
  const isDefault = value === DEFAULTS[spec.key];
  const bad = spec.type === "number" && (typeof value !== "number" || !Number.isFinite(value) || value < spec.min || value > spec.max);
  const input = "rounded-md border border-stone-200 bg-white px-2 py-1 text-xs focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/15";
  return (
    <label className="flex items-start gap-3 rounded-lg py-1" title={spec.help}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs font-medium text-stone-700">
          {spec.label}
          {!isDefault && <span className="h-1.5 w-1.5 rounded-full bg-teal-600" title="changed from the default" />}
        </div>
        <div className="text-[11px] leading-snug text-stone-500">{spec.help}</div>
        {bad && spec.type === "number" && (
          <div className="text-[11px] font-medium text-rose-700">
            between {spec.min} and {spec.max}
          </div>
        )}
      </div>
      <div className="shrink-0 pt-0.5">
        {spec.type === "toggle" ? (
          <button
            type="button"
            role="switch"
            aria-checked={!!value}
            onClick={() => onChange(!value)}
            className={cx("relative h-5 w-9 rounded-full transition", value ? "bg-teal-600" : "bg-stone-400")}
          >
            <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", value ? "left-4.5" : "left-0.5")} />
          </button>
        ) : spec.type === "select" ? (
          <select value={String(value)} onChange={(e) => onChange(e.target.value as Options[keyof Options])} className={input}>
            {spec.values.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        ) : spec.type === "number" ? (
          <input
            type="number"
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={Number(value)}
            onChange={(e) => onChange(e.target.value === "" ? DEFAULTS[spec.key] : Number(e.target.value))}
            aria-invalid={bad}
            className={cx(input, "w-24 tabular-nums", bad && "border-rose-400 bg-rose-50 text-rose-800")}
          />
        ) : (
          <input value={String(value)} placeholder={spec.placeholder} onChange={(e) => onChange(e.target.value)} className={cx(input, "w-44 font-mono placeholder:font-sans placeholder:text-stone-500 placeholder:italic")} />
        )}
      </div>
    </label>
  );
}
