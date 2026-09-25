import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ask, KIND_HINTS } from "./components/Ask";
import { Header } from "./components/Header";
import { History, OUTCOME, runSpend } from "./components/History";
import { RunView } from "./components/RunView";
import { Shelf } from "./components/Shelf";
import { spendOf } from "./log";
import { changed, commandFor, DEFAULTS, type Options, type Tool } from "./options";
import { outcomeOf, useRun, type Run } from "./run";
import { isLocate, locateHint, sourceKey } from "./sources";
import type { Config, Health, RunRequest, Scan } from "./types";
import { cx, dollars, useStored } from "./util";

const HISTORY = 40;
/** Height a run's header, facts and the top of its answer need to be seen without scrolling. */
const ANSWER_ROOM = 440;

/** The PDFs a source holds: a folder walked, or a locate command run. Never throws: a failure comes back as the scan's error. */
async function scanOf(source: string): Promise<Scan> {
  const failed = (error: string): Scan => ({ dir: sourceKey(source), files: [], ms: 0, truncated: false, error });
  try {
    const r = isLocate(source)
      ? await fetch("/api/locate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: source }) })
      : await fetch(`/api/scan?dir=${encodeURIComponent(source)}`);
    const body = (await r.json().catch(() => null)) as Scan | { error?: string } | null;
    if (body && "files" in body) return body;
    return failed(body?.error ?? `the server answered ${r.status} ${r.statusText}`);
  } catch {
    return failed("the UI server did not answer; is it still running?");
  }
}

const ledgerOf = (runs: Run[]) =>
  runs.reduce((a, r) => ({ dollars: a.dollars + runSpend(r), in: a.in + (r.end?.report?.spent.in ?? spendOf(r.lines).in), runs: a.runs + 1 }), { dollars: 0, in: 0, runs: 0 });

export function App() {
  const [health, setHealth] = useState<Health>();
  const [folders, setFolders] = useStored<string[]>("jev.folders", []);
  const [scans, setScans] = useState<Record<string, Scan | undefined>>({});
  const scansNow = useRef(scans);
  scansNow.current = scans;
  const [tool, setTool] = useStored<Tool>("jev.tool", "jevfind");
  const [question, setQuestion] = useStored("jev.question", "");
  const [options, setOptions] = useStored<Options>("jev.options", DEFAULTS);
  const [pdf, setPdf] = useStored("jev.pdf", "");
  const [history, setHistory] = useStored<Run[]>("jev.history", []);
  const [side, setSide] = useState<"shelf" | "history">("shelf");
  const [viewing, setViewing] = useState<Run>();
  // What this browser's runs have spent, kept apart from the history so clearing one keeps the other.
  const [ledger, setLedger] = useStored("jev.ledger", ledgerOf(history));
  const [note, setNote] = useState<string>();
  const [focus, setFocus] = useState(0);
  const main = useRef<HTMLElement>(null);
  const runView = useRef<HTMLDivElement>(null);
  // A run that ends while an older one is on screen leaves word of it until seen.
  const [ended, setEnded] = useState<Run>();
  const watching = useRef(true);
  const { run, start, stop } = useRun((r) => {
    if (!watching.current) setEnded(r);
    setHistory((h) => [r, ...h.filter((x) => x.id !== r.id)].slice(0, HISTORY));
    setLedger((l) => {
      const add = ledgerOf([r]);
      return { dollars: l.dollars + add.dollars, in: l.in + add.in, runs: l.runs + 1 };
    });
  });

  const checkHealth = useCallback(() => {
    fetch("/api/health")
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth, () => setHealth(undefined));
  }, []);

  /** Scans or runs a source again; one that fails keeps the list it had, with why it could not be refreshed. */
  const rescan = useCallback(async (dir: string) => {
    const before = scansNow.current[dir];
    setScans((s) => ({ ...s, [dir]: undefined }));
    const scan = await scanOf(dir);
    const kept = scan.error && before?.files.length ? { ...before, error: undefined, warning: `could not refresh (${scan.error}); showing the list from before` } : scan;
    setScans((s) => ({ ...s, [dir]: kept }));
  }, []);

  useEffect(() => {
    checkHealth();
    fetch("/api/config")
      .then((r) => r.json() as Promise<Config>)
      .then((c) => setFolders((f) => [...new Set([...f, ...c.folders])]));
  }, [checkHealth, setFolders]);

  useEffect(() => {
    for (const f of folders) if (!(f in scans)) rescan(f);
  }, [folders, scans, rescan]);

  const files = useMemo(() => {
    const seen = new Map<string, true>();
    return folders.flatMap((f) => scans[f]?.files ?? []).filter((f) => !seen.has(f.path) && seen.set(f.path, true));
  }, [folders, scans]);

  const ask = (request: RunRequest) => {
    setViewing(undefined);
    setEnded(undefined);
    setNote(undefined);
    start(request, commandFor(request.tool, request.options, request.question, { pdf: request.pdf, sources: folders }));
  };

  // An answer that arrives below the fold is scrolled up under the header; the
  // page is only tall enough to scroll once it is there.
  useEffect(() => {
    const [el, box] = [runView.current, main.current];
    if (run?.status !== "done" || viewing || !el || !box) return;
    const below = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    if (below + ANSWER_ROOM > box.clientHeight) box.scrollTo({ top: Math.max(0, below + box.scrollTop - 12), behavior: "smooth" });
  }, [run?.id, run?.status]);
  const askNow = () =>
    ask({ tool, question: question.trim(), options, ...(tool === "jevsec" ? { pdf } : { paths: files.map((f) => f.path) }) });

  /** Adds the folder or locate command, or says why not: one that lists no PDFs never goes on the shelf. */
  const addFolder = async (input: string): Promise<string | undefined> => {
    const scan = await scanOf(input);
    if (scan.error) return scan.error === "not a folder" ? `${scan.dir} is not a folder` : /ENOENT/.test(scan.error) ? `${scan.dir} does not exist` : scan.error;
    if (scan.files.length === 0) {
      if (!isLocate(input)) return `No PDFs under ${scan.dir}, so it stays off the shelf`;
      const hint = locateHint(input);
      return `${scan.dir} lists no PDFs that exist, so it stays off the shelf${hint ? `: ${hint}` : ""}`;
    }
    setScans((s) => ({ ...s, [scan.dir]: scan }));
    setFolders((f) => (f.includes(scan.dir) ? f : [...f, scan.dir]));
  };

  const pick = (path: string) => {
    setPdf(path);
    setTool("jevsec");
  };

  const shown = viewing ?? run;
  watching.current = !viewing;
  const live = run?.status === "running";
  const cacheWhy = tool !== "jevgrep" && options.cache !== "off" ? health?.cache[options.cache] : null;

  return (
    <div className="flex h-full flex-col">
      <Header health={health} cache={options.cache} spend={ledger} onRefresh={checkHealth} onResetSpend={() => setLedger({ dollars: 0, in: 0, runs: 0 })} />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-stone-200 bg-stone-50 xl:w-80">
          <div role="tablist" className="flex gap-1 border-b border-stone-200 px-3 pt-2">
            {(["shelf", "history"] as const).map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={side === s}
                onClick={() => setSide(s)}
                className={cx("-mb-px border-b-2 px-2.5 py-2 text-sm font-medium capitalize", side === s ? "border-teal-700 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-800")}
              >
                {s}
                <span className="ml-1.5 rounded-full bg-stone-200/70 px-1.5 text-[11px] font-semibold text-stone-500">{s === "shelf" ? files.length : history.length}</span>
              </button>
            ))}
          </div>
          {side === "shelf" ? (
            <Shelf
              folders={folders}
              scans={scans}
              picked={pdf}
              onAdd={addFolder}
              onRemove={(d) => setFolders((f) => f.filter((x) => x !== d))}
              onRescan={rescan}
              onPick={pick}
            />
          ) : (
            <History runs={history} current={shown?.id} onOpen={setViewing} onClear={() => setHistory([])} />
          )}
        </aside>

        <main ref={main} className="scroll-thin min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl space-y-5 px-4 py-5 xl:px-6 xl:py-6">
            <Ask
              tool={tool}
              setTool={setTool}
              question={question}
              setQuestion={setQuestion}
              options={options}
              setOptions={setOptions}
              pdf={pdf || undefined}
              folders={folders}
              files={files.length}
              running={live}
              onAsk={askNow}
              onStop={stop}
              note={note}
              onDismissNote={() => setNote(undefined)}
              focus={focus}
              cacheWhy={cacheWhy ?? undefined}
              onCacheOffOnce={() => ask({ tool, question: question.trim(), options: { ...options, cache: "off" }, ...(tool === "jevsec" ? { pdf } : { paths: files.map((f) => f.path) }) })}
            />
            {viewing && live && (
              <button onClick={() => setViewing(undefined)} className="w-full rounded-xl bg-sky-50 px-4 py-2 text-left text-sm text-sky-800 ring-1 ring-sky-600/20 hover:bg-sky-100">
                A question is still running. Show it →
              </button>
            )}
            {viewing && ended && ended.id !== viewing.id && (
              <div className="flex items-center gap-3 rounded-xl bg-white px-4 py-2 text-sm ring-1 ring-stone-200">
                <span className={cx("h-2 w-2 rounded-full", OUTCOME[outcomeOf(ended)].dot)} />
                <span className="min-w-0 flex-1 truncate text-stone-700">
                  Finished: <span className="font-medium">{OUTCOME[outcomeOf(ended)].label}</span> · {dollars(runSpend(ended))} · “{ended.request.question}”
                </span>
                <button
                  onClick={() => {
                    setViewing(undefined);
                    setEnded(undefined);
                  }}
                  className="rounded-md px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50"
                >
                  Show it →
                </button>
                <button onClick={() => setEnded(undefined)} aria-label="Dismiss" className="text-stone-400 hover:text-stone-700">
                  ×
                </button>
              </div>
            )}
            {shown ? (
              <div ref={runView}>
              <RunView
                run={shown}
                onStop={stop}
                onPick={pick}
                // A retry changes this run only; the saved options stay as they are.
                onRetry={(patch) => ask({ ...shown.request, options: { ...shown.request.options, ...patch } })}
                onEdit={() => {
                  const r = shown.request;
                  const restored = { ...DEFAULTS, ...r.options };
                  const diff = changed(r.tool, restored);
                  setTool(r.tool);
                  setQuestion(r.question);
                  setOptions(restored);
                  if (r.pdf) setPdf(r.pdf);
                  setNote(`Restored from that run: ${diff.length ? diff.map((d) => `${d.label} ${String(restored[d.key])}`).join(", ") : "every option at its default"}.`);
                  main.current?.scrollTo({ top: 0, behavior: "smooth" });
                  setFocus((n) => n + 1);
                }}
              />
              </div>
            ) : (
              <Welcome />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function Welcome() {
  const steps = [
    { n: "1", title: "Put PDFs on the shelf", body: "Add a folder, or a locate command such as plocate -i '*.pdf', on the left. Nothing is read or sent until you ask." },
    { n: "2", title: "Ask in plain words", body: "The whole shelf, one PDF, or just the file names. jev reads the kind of answer off the wording." },
    { n: "3", title: "Read the page itself", body: "Every answer is a number, true or false, a passage or a table of the book's own text, with the page it stands on, highlighted." },
  ];
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        {steps.map((s) => (
          <div key={s.n} className="rounded-2xl border border-stone-200 bg-white p-5">
            <div className="mb-3 flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 font-serif text-sm font-semibold text-white">{s.n}</div>
            <div className="font-medium text-stone-900">{s.title}</div>
            <div className="mt-1 text-sm leading-relaxed text-stone-500">{s.body}</div>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-stone-200 bg-white">
        <div className="border-b border-stone-100 px-5 py-3 text-sm font-semibold text-stone-800">What you get back depends on how you ask</div>
        <table className="w-full text-sm">
          <tbody>
            {KIND_HINTS.map((k) => (
              <tr key={k.kind} className="border-b border-stone-100 last:border-0">
                <td className="w-24 px-5 py-2.5">
                  <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800 ring-1 ring-teal-600/20">{k.kind}</span>
                </td>
                <td className="py-2.5 font-serif text-stone-700">{k.says}</td>
                <td className="px-5 py-2.5 text-right text-stone-500">{k.gives}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-center text-xs text-stone-400">
        Each question costs a fraction of a cent: jev charges $0.042 per million tokens in. Every step's tokens show in the log. Press <kbd className="rounded bg-stone-200 px-1">/</kbd> to type a question.
      </p>
    </div>
  );
}
