import { useCallback, useEffect, useMemo, useState } from "react";
import { Ask, KIND_HINTS } from "./components/Ask";
import { Header } from "./components/Header";
import { History, runSpend } from "./components/History";
import { RunView } from "./components/RunView";
import { Shelf } from "./components/Shelf";
import { commandFor, DEFAULTS, type Options, type Tool } from "./options";
import { useRun, type Run } from "./run";
import type { Config, Health, RunRequest, Scan } from "./types";
import { cx, useStored } from "./util";

const HISTORY = 40;

async function scanOf(dir: string): Promise<Scan> {
  const r = await fetch(`/api/scan?dir=${encodeURIComponent(dir)}`);
  return (await r.json()) as Scan;
}

export function App() {
  const [health, setHealth] = useState<Health>();
  const [folders, setFolders] = useStored<string[]>("jev.folders", []);
  const [scans, setScans] = useState<Record<string, Scan | undefined>>({});
  const [tool, setTool] = useStored<Tool>("jev.tool", "jevfind");
  const [question, setQuestion] = useStored("jev.question", "");
  const [options, setOptions] = useStored<Options>("jev.options", DEFAULTS);
  const [pdf, setPdf] = useStored("jev.pdf", "");
  const [history, setHistory] = useStored<Run[]>("jev.history", []);
  const [side, setSide] = useState<"shelf" | "history">("shelf");
  const [viewing, setViewing] = useState<Run>();
  const { run, start, stop } = useRun((r) => setHistory((h) => [r, ...h.filter((x) => x.id !== r.id)].slice(0, HISTORY)));

  const checkHealth = useCallback(() => {
    fetch("/api/health")
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth, () => setHealth(undefined));
  }, []);

  const rescan = useCallback(async (dir: string) => {
    setScans((s) => ({ ...s, [dir]: undefined }));
    const scan = await scanOf(dir);
    setScans((s) => ({ ...s, [dir]: scan }));
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

  const spend = useMemo(
    () => history.reduce((a, r) => ({ dollars: a.dollars + runSpend(r), in: a.in + (r.end?.report?.spent.in ?? 0), runs: a.runs + 1 }), { dollars: 0, in: 0, runs: 0 }),
    [history],
  );

  const ask = (request: RunRequest) => {
    setViewing(undefined);
    start(request, commandFor(request.tool, request.options, request.question, { pdf: request.pdf, folders }));
  };
  const askNow = () =>
    ask({ tool, question: question.trim(), options, ...(tool === "jevsec" ? { pdf } : { paths: files.map((f) => f.path) }) });

  const addFolder = async (input: string) => {
    const scan = await scanOf(input);
    setScans((s) => ({ ...s, [scan.dir]: scan }));
    setFolders((f) => (f.includes(scan.dir) ? f : [...f, scan.dir]));
  };

  const pick = (path: string) => {
    setPdf(path);
    setTool("jevsec");
  };

  const shown = viewing ?? run;
  const live = run?.status === "running";

  return (
    <div className="flex h-full flex-col">
      <Header health={health} cache={options.cache} spend={spend} onRefresh={checkHealth} />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col border-r border-stone-200 bg-stone-50">
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

        <main className="scroll-thin min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
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
            />
            {viewing && live && (
              <button onClick={() => setViewing(undefined)} className="w-full rounded-xl bg-sky-50 px-4 py-2 text-left text-sm text-sky-800 ring-1 ring-sky-600/20 hover:bg-sky-100">
                A question is still running. Show it →
              </button>
            )}
            {shown ? (
              <RunView
                run={shown}
                onStop={stop}
                onPick={pick}
                onRetry={(patch) => {
                  const next = { ...shown.request.options, ...patch };
                  setOptions(next);
                  ask({ ...shown.request, options: next });
                }}
                onEdit={() => {
                  const r = shown.request;
                  setTool(r.tool);
                  setQuestion(r.question);
                  setOptions({ ...DEFAULTS, ...r.options });
                  if (r.pdf) setPdf(r.pdf);
                  window.scrollTo({ top: 0 });
                }}
              />
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
    { n: "1", title: "Put PDFs on the shelf", body: "Add a folder on the left. Nothing is read or sent until you ask." },
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
