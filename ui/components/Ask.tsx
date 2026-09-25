import { useEffect, useRef, useState } from "react";
import { changed, commandFor, DEFAULTS, invalid, SPECS, type Options, type Spec, type Tool } from "../options";
import { basename, copy, cx } from "../util";
import { useToast } from "./Toast";

const MODES: { tool: Tool; label: string; asks: string; cost: string }[] = [
  { tool: "jevfind", label: "Whole shelf", asks: "Which page of which PDF answers it?", cost: "ranks the paths, then reads the best files" },
  { tool: "jevsec", label: "One PDF", asks: "Which page of this PDF answers it?", cost: "ranks its sections, then reads the best pages" },
  { tool: "jevgrep", label: "File names", asks: "Which filenames could answer it?", cost: "names only, one call, reads no file" },
];

/** How the wording picks the kind of answer; jev reads it, --kind forces it. */
export const KIND_HINTS = [
  { kind: "count", says: "How many … are there?", gives: "a number, counted off the list" },
  { kind: "number", says: "How much does … cost?", gives: "a figure read off the page" },
  { kind: "truth", says: "A statement to check", gives: "true or false" },
  { kind: "passage", says: "How do I …?", gives: "the sentences that answer" },
  { kind: "table", says: "Make a table of … with …", gives: "a table built to the question" },
] as const;

/** Why the question cannot be asked yet, or undefined when it can. */
export function whyBlocked(a: { tool: Tool; question: string; options: Options; pdf?: string; files: number; cacheWhy?: string }): string | undefined {
  if (!a.question.trim()) return "Type a question";
  if (a.tool === "jevsec" && !a.pdf) return "Pick a PDF on the shelf";
  if (a.tool !== "jevsec" && a.files === 0) return "Add a folder or a locate command to the shelf";
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
  folders: string[];
  files: number;
  running: boolean;
  onAsk: () => void;
  onStop: () => void;
  /** A line to show under the question, like what "ask again" restored. */
  note?: string;
  onDismissNote: () => void;
  /** Bumped to move the cursor into the question. */
  focus: number;
  /** Why the chosen ranking cache cannot run, when it cannot. */
  cacheWhy?: string;
  onCacheOffOnce: () => void;
  /** Earlier questions like the one being typed, offered while the box has focus. */
  suggestions: string[];
};

export function Ask(props: Props) {
  const { tool, setTool, question, setQuestion, options, setOptions, pdf, folders, files, running, onAsk, onStop, note, onDismissNote, focus, cacheWhy, onCacheOffOnce, suggestions } = props;
  const [showOptions, setShowOptions] = useState(false);
  const [typing, setTyping] = useState(false);
  const toast = useToast();
  const box = useRef<HTMLTextAreaElement>(null);
  const diff = changed(tool, options);
  const mode = MODES.find((m) => m.tool === tool)!;
  const blocked = whyBlocked({ tool, question, options, pdf, files, cacheWhy });
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
    if (focus) box.current?.focus();
  }, [focus]);

  return (
    <section className="rounded-2xl border border-stone-200 bg-white shadow-sm">
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
              pdf ? (
                <span>
                  in <span className="font-medium text-teal-800">{basename(pdf)}</span>; {mode.cost}
                </span>
              ) : (
                <span className="text-amber-700">Pick a PDF on the shelf to ask it alone</span>
              )
            ) : (
              <span>
                {files} PDF{files === 1 ? "" : "s"} on the shelf; {mode.cost}
              </span>
            )}
          </div>
        </div>
      </div>

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
          }}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          rows={2}
          placeholder={tool === "jevgrep" ? "What are you looking for? jev ranks the filenames against it" : "Ask a question, or state something to check"}
          aria-label="Question"
          className="w-full resize-none border-0 bg-transparent font-serif text-lg leading-snug text-stone-900 placeholder:text-stone-400 focus:outline-none"
        />
      </div>

      {typing && suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2" aria-label="Earlier questions">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-stone-400">{question.trim() ? "asked before" : "recent"}</span>
          {suggestions.map((s) => (
            <button
              key={s}
              // Pressing must not blur the box, or the row goes before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setQuestion(s)}
              className="max-w-full truncate rounded-full bg-stone-50 px-2.5 py-0.5 font-serif text-xs text-stone-700 ring-1 ring-stone-200 hover:bg-teal-50 hover:ring-teal-600/30"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {tool !== "jevgrep" && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-stone-400">{options.kind === "auto" ? "the wording picks the answer" : "kind forced in Options"}</span>
          {KIND_HINTS.map((k) => (
            <span
              key={k.kind}
              title={`${k.says} → ${k.gives}`}
              className={cx(
                "rounded-full px-2 py-0.5 text-[11px] ring-1",
                options.kind === k.kind ? "bg-teal-700 text-white ring-teal-700" : "bg-stone-50 text-stone-600 ring-stone-200",
              )}
            >
              <span className="font-semibold">{k.kind}</span> <span className={cx("hidden 2xl:inline", options.kind === k.kind ? "text-teal-100" : "text-stone-400")}>{k.says}</span>
            </span>
          ))}
        </div>
      )}

      {note && (
        <div className="mx-4 mb-2 flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-1.5 text-xs text-sky-900 ring-1 ring-sky-600/20">
          <span className="flex-1">{note}</span>
          <button onClick={onDismissNote} aria-label="Dismiss" className="text-sky-500 hover:text-sky-800">
            ×
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
          <span className={cx("text-[10px] text-stone-400 transition-transform", showOptions && "rotate-90")}>▶</span>
          Options
          {diff.length > 0 && <span className="rounded-full bg-teal-100 px-1.5 text-[11px] font-semibold text-teal-800">{diff.length} changed</span>}
        </button>
        {diff.length > 0 && !showOptions && (
          <div className="hidden min-w-0 flex-1 truncate text-xs text-stone-400 lg:block">{diff.map((s) => `${s.label}: ${String(options[s.key])}`).join(" · ")}</div>
        )}
        <div className="ml-auto flex items-center gap-3">
          {!running && blocked && <span className={cx("text-xs", blocked === "Type a question" ? "text-stone-400" : "font-medium text-amber-700")}>{blocked}</span>}
          {running ? (
            <button onClick={onStop} className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-500">
              Stop <kbd className="ml-1 text-[10px] font-normal text-rose-200">esc</kbd>
            </button>
          ) : (
            <button
              onClick={onAsk}
              disabled={!!blocked}
              className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              Ask <kbd className="ml-1 text-[10px] font-normal text-teal-200">⏎</kbd>
            </button>
          )}
        </div>
      </div>

      {showOptions && <OptionsPanel tool={tool} options={options} setOptions={setOptions} />}

      <div className="flex items-start gap-2 rounded-b-2xl border-t border-stone-100 bg-stone-50 px-4 py-2">
        <span className="shrink-0 font-mono text-[11px] text-stone-400">$</span>
        <code className="min-w-0 flex-1 font-mono text-[11px] [overflow-wrap:anywhere] text-stone-600" title="The same run from a terminal in the repo">
          {command}
        </code>
        <button onClick={async () => toast((await copy(command)) ? "Command copied" : "Could not reach the clipboard", "ok")} className="shrink-0 rounded-md px-2 py-0.5 text-[11px] text-stone-500 hover:bg-stone-200">
          copy
        </button>
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
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{g.title}</div>
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
        <div className="text-[11px] leading-snug text-stone-400">{spec.help}</div>
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
            className={cx("relative h-5 w-9 rounded-full transition", value ? "bg-teal-600" : "bg-stone-300")}
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
          <input value={String(value)} placeholder={spec.placeholder} onChange={(e) => onChange(e.target.value)} className={cx(input, "w-44 font-mono")} />
        )}
      </div>
    </label>
  );
}
