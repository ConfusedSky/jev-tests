import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ask, whyBlocked } from "./components/Ask";
import { Header } from "./components/Header";
import { History } from "./components/History";
import { Palette } from "./components/Palette";
import { RunView } from "./components/RunView";
import { Shelf } from "./components/Shelf";
import { Shortcuts } from "./components/Shortcuts";
import { useToast } from "./components/Toast";
import { Welcome } from "./components/Welcome";
import { fileStem, runJson } from "./export";
import { ordered, recentQuestions, remember } from "./history";
import { OUTCOME, runSpend, TOOL_LABEL } from "./labels";
import { spendOf } from "./log";
import { changed, commandFor, DEFAULTS, type Options, type Tool } from "./options";
import type { Item } from "./palette";
import { outcomeOf, useRun, type Run } from "./run";
import { isLocate, locateHint, sourceKey } from "./sources";
import { nextTheme, useTheme } from "./theme";
import type { Config, Health, RunRequest, Scan } from "./types";
import { hashFor, runInHash } from "./url";
import { cx, dollars, download, secs, useMediaQuery, useStored } from "./util";

const HISTORY = 40;
/** Height a run's header, facts and the top of its answer need to be seen without scrolling. */
const ANSWER_ROOM = 440;
const TITLE = document.title;

/** The PDFs a source holds: a folder walked, or a locate command run. Never throws: a failure comes back as the scan's error. */
async function scanOf(source: string): Promise<Scan> {
  const failed = (error: string): Scan => ({ dir: sourceKey(source), files: [], ms: 0, truncated: false, error });
  try {
    const r = isLocate(source)
      ? await fetch("/api/locate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: source }) })
      : await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dir: source }) });
    const body = (await r.json().catch(() => null)) as Scan | { error?: string } | null;
    if (body && "files" in body) return body;
    return failed(body?.error ?? `the server answered ${r.status} ${r.statusText}`);
  } catch {
    return failed("the UI server did not answer; is it still running?");
  }
}

const ledgerOf = (runs: Run[]) =>
  runs.reduce((a, r) => ({ dollars: a.dollars + runSpend(r), in: a.in + (r.end?.report?.spent.in ?? spendOf(r.lines).in), runs: a.runs + 1 }), { dollars: 0, in: 0, runs: 0 });

const typing = (e: KeyboardEvent) => {
  const el = e.target;
  return el instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
};

export function App() {
  const toast = useToast();
  const [health, setHealth] = useState<Health>();
  // History, spend, the shelf and the theme are the browser's, shared by its tabs; the form is each tab's own.
  const [folders, setFolders] = useStored<string[]>("jev.folders", [], true);
  // Sources the server was started with go on the shelf once; taken off, they stay off.
  const [seeded, setSeeded] = useStored<string[]>("jev.seeded", [], true);
  const [scans, setScans] = useState<Record<string, Scan | undefined>>({});
  const scansNow = useRef(scans);
  scansNow.current = scans;
  const [tool, setTool] = useStored<Tool>("jev.tool", "jevfind");
  const [question, setQuestion] = useStored("jev.question", "");
  const [options, setOptions] = useStored<Options>("jev.options", DEFAULTS);
  const [pdf, setPdf] = useStored("jev.pdf", "");
  const [history, setHistory] = useStored<Run[]>("jev.history", [], true);
  const [side, setSide] = useState<"shelf" | "history">("shelf");
  // What this browser's runs have spent, kept apart from the history so clearing one keeps the other.
  const [ledger, setLedger] = useStored("jev.ledger", ledgerOf(history), true);
  const [note, setNote] = useState<string>();
  const [focus, setFocus] = useState(0);
  const main = useRef<HTMLElement>(null);
  const runView = useRef<HTMLDivElement>(null);
  const { theme, setTheme } = useTheme();
  const [notify, setNotify] = useStored("jev.notify", false);
  const notifyNow = useRef(notify);
  notifyNow.current = notify;
  const [sidebar, setSidebar] = useStored("jev.sidebar", true);
  const narrow = useMediaQuery("(max-width: 767px)");
  // On a narrow window the sidebar is a drawer over the page, shut until asked for.
  const [drawer, setDrawer] = useState(false);
  const [dialog, setDialog] = useState<"palette" | "shortcuts">();
  const [said, setSaid] = useState("");
  const [badge, setBadge] = useState<string>();

  // The run on screen, named in the address so a reload and the back button return to it; null is the welcome page.
  const [viewingId, setViewingId] = useState<string | null>(() => {
    const wanted = runInHash(location.hash);
    return (wanted && history.some((r) => r.id === wanted) ? wanted : history[0]?.id) ?? null;
  });
  const viewingNow = useRef(viewingId);
  viewingNow.current = viewingId;
  const view = useCallback((id: string | null, push = true) => {
    setViewingId(id);
    const url = hashFor(id ?? undefined) || location.pathname;
    if (push) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, []);

  // A run that ends while an older one is on screen leaves word of it until seen.
  const [ended, setEnded] = useState<Run>();
  const { run, setRun, start, stop } = useRun((r) => {
    if (r.id !== viewingNow.current) setEnded(r);
    setHistory((h) => remember(h, r, HISTORY));
    setLedger((l) => {
      const add = ledgerOf([r]);
      return { dollars: l.dollars + add.dollars, in: l.in + add.in, runs: l.runs + 1 };
    });
    const outcome = OUTCOME[outcomeOf(r)].label;
    setSaid(`${outcome}: ${r.request.question}. ${secs(r.end?.ms ?? 0)}, ${dollars(runSpend(r))}.`);
    if (document.hidden) {
      setBadge(outcome);
      if (notifyNow.current && Notification.permission === "granted") new Notification(`jev: ${outcome}`, { body: r.request.question, tag: r.id }).onclick = () => window.focus();
    }
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

  // Runs once: the address is made to say what is shown, and the server's sources not seen before go on the shelf.
  useEffect(() => {
    view(viewingNow.current, false);
    checkHealth();
    fetch("/api/config")
      .then((r) => r.json() as Promise<Config>)
      .then((c) => {
        const fresh = c.folders.filter((f) => !seeded.includes(f));
        if (fresh.length === 0) return;
        setFolders((f) => [...new Set([...f, ...fresh])]);
        setSeeded([...seeded, ...fresh]);
      });
    const back = () => setViewingId(runInHash(location.hash) ?? null);
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);

  useEffect(() => {
    for (const f of folders) if (!(f in scans)) rescan(f);
  }, [folders, scans, rescan]);

  const files = useMemo(() => {
    const seen = new Map<string, true>();
    return folders.flatMap((f) => scans[f]?.files ?? []).filter((f) => !seen.has(f.path) && seen.set(f.path, true));
  }, [folders, scans]);

  // A PDF picked from a source since taken off the shelf is let go, once every source has answered.
  useEffect(() => {
    if (pdf && folders.every((f) => scans[f] !== undefined) && !files.some((f) => f.path === pdf)) setPdf("");
  }, [pdf, files, folders, scans, setPdf]);

  // The tab's title says how a run ended while it was in the background, until it is looked at.
  useEffect(() => {
    document.title = badge ? `(${badge}) ${TITLE}` : TITLE;
  }, [badge]);
  useEffect(() => {
    const seen = () => !document.hidden && setBadge(undefined);
    document.addEventListener("visibilitychange", seen);
    return () => document.removeEventListener("visibilitychange", seen);
  }, []);

  // One run at a time: starting another aborts the live one, and that is Stop's job, never a side effect.
  const ask = (request: RunRequest) => {
    if (run?.status === "running") {
      toast("A question is still running. Stop it first, or wait for it to end.");
      return;
    }
    setEnded(undefined);
    setNote(undefined);
    const id = start(request, commandFor(request.tool, request.options, request.question, { pdf: request.pdf, sources: folders }));
    view(id);
    setSaid(`Asking: ${request.question}`);
    setDrawer(false);
  };

  const shown = viewingId === null ? undefined : run?.id === viewingId ? run : history.find((r) => r.id === viewingId);
  const live = run?.status === "running";

  // An answer that arrives below the fold is scrolled up under the header; the
  // page is only tall enough to scroll once it is there.
  useEffect(() => {
    const [el, box] = [runView.current, main.current];
    if (run?.status !== "done" || shown?.id !== run.id || !el || !box) return;
    const below = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    if (below + ANSWER_ROOM > box.clientHeight) box.scrollTo({ top: Math.max(0, below + box.scrollTop - 12), behavior: "smooth" });
  }, [run?.id, run?.status]);

  const cacheWhy = tool !== "jevgrep" && options.cache !== "off" ? health?.cache[options.cache] : null;
  const target = () => (tool === "jevsec" ? { pdf } : { paths: files.map((f) => f.path) });
  const blocked = whyBlocked({ tool, question, options, pdf: pdf || undefined, files: files.length, cacheWhy: cacheWhy ?? undefined });
  const askNow = () => {
    if (live || blocked) return;
    ask({ tool, question: question.trim(), options, ...target() });
  };

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
    toast(`${scan.files.length} PDF${scan.files.length === 1 ? "" : "s"} on the shelf from ${scan.dir}`);
  };

  const removeFolder = (dir: string) => {
    setFolders((f) => f.filter((x) => x !== dir));
    toast(`${dir} taken off the shelf`);
  };

  const pick = (path: string) => {
    setPdf(path);
    setTool("jevsec");
    setDrawer(false);
  };

  const open = (r: Run) => {
    view(r.id);
    setDrawer(false);
    if (ended?.id === r.id) setEnded(undefined);
  };

  /** Restores a run's question and options into the form. */
  const edit = (r: Run) => {
    const restored = { ...DEFAULTS, ...r.request.options };
    const diff = changed(r.request.tool, restored);
    setTool(r.request.tool);
    setQuestion(r.request.question);
    setOptions(restored);
    if (r.request.pdf) setPdf(r.request.pdf);
    setNote(`Restored from that run: ${diff.length ? diff.map((d) => `${d.label} ${String(restored[d.key])}`).join(", ") : "every option at its default"}.`);
    main.current?.scrollTo({ top: 0, behavior: "smooth" });
    setFocus((n) => n + 1);
  };

  // Clearing takes the shown run off the screen too, unless it is pinned or still going.
  const clearHistory = () => {
    const keep = new Set(history.filter((r) => r.pinned).map((r) => r.id));
    if (live && run) keep.add(run.id);
    setHistory((h) => h.filter((r) => keep.has(r.id)));
    if (run && !keep.has(run.id)) setRun(undefined);
    if (viewingId && !keep.has(viewingId)) view(null, false);
    toast(keep.size ? "History cleared, but for what is pinned or running" : "History cleared");
  };

  const deleteRun = (id: string) => {
    setHistory((h) => h.filter((r) => r.id !== id));
    if (run?.id === id) setRun(undefined);
    if (viewingId === id) view(null, false);
    toast("Run deleted");
  };

  const pinRun = (id: string) => setHistory((h) => h.map((r) => (r.id === id ? { ...r, pinned: !r.pinned } : r)));

  const setNotifyAsking = async (on: boolean) => {
    if (on && Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") {
      toast("This site is not allowed to show notifications", "warn");
      setNotify(false);
      return;
    }
    setNotify(on);
    toast(on ? "You will be told when a run ends while the tab is in the background" : "Desktop notifications off");
  };

  const toggleSide = () => (narrow ? setDrawer((d) => !d) : setSidebar((s) => !s));

  /** Shows the run before or after the one on screen, in the history's order. */
  const step = (by: 1 | -1) => {
    const list = ordered(history);
    const at = list.findIndex((r) => r.id === shown?.id);
    const next = list[at < 0 ? (by > 0 ? 0 : list.length - 1) : at + by];
    if (next) open(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A popover or dialog that took the key has done with it.
      if (e.defaultPrevented) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDialog((d) => (d === "palette" ? undefined : "palette"));
        return;
      }
      if (dialog || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "/") setFocus((n) => n + 1);
      else if (e.key === "?") setDialog("shortcuts");
      else if (e.key === "b") toggleSide();
      else if (e.key === "[") step(1);
      else if (e.key === "]") step(-1);
      else if (e.key === "Escape" && drawer) setDrawer(false);
      else if (e.key === "Escape" && live) stop();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const items = (): Item[] => {
    const act = (id: string, label: string, run: () => void, extra: Partial<Item> = {}): Item => ({ id, group: "Actions", label, run, ...extra });
    const modes: { tool: Tool; label: string }[] = [
      { tool: "jevfind", label: "Ask the whole shelf" },
      { tool: "jevsec", label: "Ask one PDF" },
      { tool: "jevgrep", label: "Rank the file names" },
    ];
    return [
      live ? act("stop", "Stop the run", stop, { shortcut: "esc" }) : act("ask", "Ask", askNow, { hint: blocked ?? `“${question.trim()}”`, shortcut: "⏎" }),
      act("focus", "Type a question", () => setFocus((n) => n + 1), { shortcut: "/" }),
      ...(shown && shown.status !== "running"
        ? [
            act("again", "Ask again, with that run's question and options", () => edit(shown)),
            act("json", "Save the run as JSON", () => {
              const name = `jev-${fileStem(shown.request.question)}.json`;
              download(name, runJson(shown), "application/json");
              toast(`Saved ${name}`);
            }),
          ]
        : []),
      act("theme", `Theme: ${theme} → ${nextTheme(theme)}`, () => setTheme(nextTheme(theme)), { keywords: "dark light mode appearance" }),
      act("sidebar", sidebar || drawer ? "Hide the sidebar" : "Show the sidebar", toggleSide, { shortcut: "b" }),
      act("notify", notify ? "Desktop notifications: off" : "Desktop notifications: on", () => setNotifyAsking(!notify)),
      act("keys", "Keyboard shortcuts", () => setDialog("shortcuts"), { shortcut: "?" }),
      act("clear", "Clear the history", clearHistory),
      ...modes.map<Item>((m) => ({ id: `mode-${m.tool}`, group: "Mode", label: m.label, hint: m.tool, run: () => setTool(m.tool) })),
      ...files.map<Item>((f) => ({ id: `pdf-${f.path}`, group: "Ask one PDF", label: f.name, hint: f.path, run: () => pick(f.path) })),
      ...ordered(history).map<Item>((r) => ({
        id: `run-${r.id}`,
        group: "History",
        label: r.request.question,
        hint: `${OUTCOME[outcomeOf(r)].label} · ${TOOL_LABEL[r.request.tool]} · ${dollars(runSpend(r))}`,
        run: () => open(r),
      })),
      ...recentQuestions(history, "", 8).map<Item>((q) => ({
        id: `q-${q}`,
        group: "Ask again",
        label: q,
        run: () => {
          setQuestion(q);
          setFocus((n) => n + 1);
        },
      })),
    ];
  };

  const sideOpen = narrow ? drawer : sidebar;
  const closeDialog = useCallback(() => setDialog(undefined), []);

  return (
    <div className="flex h-full flex-col">
      <div role="status" aria-live="polite" className="sr-only">
        {said}
      </div>
      <Header
        health={health}
        cache={options.cache}
        spend={ledger}
        onRefresh={checkHealth}
        onResetSpend={() => setLedger({ dollars: 0, in: 0, runs: 0 })}
        sidebar={sideOpen}
        onSidebar={toggleSide}
        theme={theme}
        onTheme={() => setTheme(nextTheme(theme))}
        onPalette={() => setDialog("palette")}
        notify={notify}
        onNotify={setNotifyAsking}
      />
      <div className="relative flex min-h-0 flex-1">
        {narrow && drawer && <div className="fixed inset-0 z-30 bg-black/40" onClick={() => setDrawer(false)} />}
        <aside
          inert={!sideOpen}
          className={cx(
            "flex w-64 shrink-0 flex-col border-r border-stone-200 bg-stone-50 xl:w-80",
            narrow ? cx("fixed top-14 bottom-0 left-0 z-40 w-72 shadow-2xl transition-transform", drawer ? "translate-x-0" : "-translate-x-full") : !sidebar && "hidden",
          )}
        >
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
            <Shelf folders={folders} scans={scans} picked={pdf} onAdd={addFolder} onRemove={removeFolder} onRescan={rescan} onPick={pick} />
          ) : (
            <History runs={history} current={shown?.id} onOpen={open} onClear={clearHistory} onPin={pinRun} onDelete={deleteRun} />
          )}
        </aside>

        <main ref={main} className="scroll-thin min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl space-y-5 px-3 py-4 md:px-4 md:py-5 xl:px-6 xl:py-6">
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
              onCacheOffOnce={() => ask({ tool, question: question.trim(), options: { ...options, cache: "off" }, ...target() })}
              suggestions={recentQuestions(history, question)}
            />
            {live && run && shown?.id !== run.id && (
              <button onClick={() => open(run)} className="w-full rounded-xl bg-sky-50 px-4 py-2 text-left text-sm text-sky-800 ring-1 ring-sky-600/20 hover:bg-sky-100">
                A question is still running. Show it →
              </button>
            )}
            {ended && ended.id !== shown?.id && (
              <div className="flex items-center gap-3 rounded-xl bg-white px-4 py-2 text-sm ring-1 ring-stone-200">
                <span className={cx("h-2 w-2 rounded-full", OUTCOME[outcomeOf(ended)].dot)} />
                <span className="min-w-0 flex-1 truncate text-stone-700">
                  Finished: <span className="font-medium">{OUTCOME[outcomeOf(ended)].label}</span> · {dollars(runSpend(ended))} · “{ended.request.question}”
                </span>
                <button onClick={() => open(ended)} className="rounded-md px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50">
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
                  onEdit={() => edit(shown)}
                />
              </div>
            ) : (
              <Welcome />
            )}
          </div>
        </main>
      </div>
      {dialog === "palette" && <Palette items={items()} onClose={closeDialog} />}
      {dialog === "shortcuts" && <Shortcuts onClose={closeDialog} />}
    </div>
  );
}
