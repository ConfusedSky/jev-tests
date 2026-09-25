import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ask, KIND_HINTS, whyBlocked } from "./components/Ask";
import { Header } from "./components/Header";
import { History } from "./components/History";
import { Icon } from "./components/Icon";
import { Palette } from "./components/Palette";
import { Notice } from "./components/Result";
import { RunView } from "./components/RunView";
import { Shelf } from "./components/Shelf";
import { Shortcuts } from "./components/Shortcuts";
import { useToast } from "./components/Toast";
import { Welcome } from "./components/Welcome";
import { fileStem, runJson } from "./export";
import { useFocusInside, useTabTrap } from "./focus";
import { byTime, ordered, recentQuestions, remember, restore, stepFrom, successor } from "./history";
import { charge, ledgerOf, OUTCOME, runSpend, spentOver, TOOL_LABEL, type Ledger } from "./labels";
import { changed, commandFor, DEFAULTS, type Options, type Tool } from "./options";
import { spendOf } from "./log";
import type { Item } from "./palette";
import { leftRun, OFFLINE, outcomeOf, useRun, type Run } from "./run";
import { isLocate, locateHint, sourceKey } from "./sources";
import { THEME_LABEL, THEMES, useTheme } from "./theme";
import type { Config, Health, RunRequest, Scan } from "./types";
import { hashFor, runInHash } from "./url";
import { basename, copy, cx, dirname, dollars, download, plural, readStored, secs, useMediaQuery, useStored, writeStored } from "./util";

const HISTORY = 40;
/** Height a run's header, facts and the top of its answer need to be seen without scrolling. */
const ANSWER_ROOM = 440;
const TITLE = document.title;
const NO_SPEND: Ledger = { dollars: 0, in: 0, runs: 0 };

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
    return failed(OFFLINE);
  }
}

const typing = (e: KeyboardEvent) => {
  const el = e.target;
  return el instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
};

export function App() {
  const toast = useToast();
  const [health, setHealth] = useState<Health | "down">();
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
  const [ledger, setLedger] = useStored<Ledger>("jev.ledger", ledgerOf(history), true);
  const ledgerNow = useRef(ledger);
  ledgerNow.current = ledger;
  const [budget, setBudget] = useStored("jev.budget", 0, true);
  const budgetNow = useRef(budget);
  budgetNow.current = budget;
  const [note, setNote] = useState<string>();
  const [focus, setFocus] = useState<{ n: number; select?: string | true }>({ n: 0 });
  const main = useRef<HTMLElement>(null);
  const runView = useRef<HTMLDivElement>(null);
  const aside = useRef<HTMLElement>(null);
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
  // Set once the page is going: the run it had is saved as stopped, and its end, if it comes, is not counted again.
  const leaving = useRef(false);

  // The run on screen, named in the address so a reload and the back button return to it; null is the welcome page.
  // A run the address names that this browser does not have stays named, and the page says so.
  const [viewingId, setViewingId] = useState<string | null>(() => runInHash(location.hash) ?? byTime(history)[0]?.id ?? null);
  const viewingNow = useRef(viewingId);
  viewingNow.current = viewingId;
  const view = useCallback((id: string | null, push = true) => {
    setViewingId(id);
    const url = hashFor(id ?? undefined) || location.pathname;
    if (push) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, []);

  const checkHealth = useCallback(() => {
    // An answer like the last leaves the page as it is, so polling does not re-render it.
    const got = (h: Health | "down" | undefined) => setHealth((old) => (JSON.stringify(old) === JSON.stringify(h) ? old : h));
    fetch("/api/health").then(
      (r) => (r.ok ? (r.json() as Promise<Health>).then(got, () => got(undefined)) : got(undefined)),
      () => got("down"),
    );
  }, []);

  // A run that ends while an older one is on screen leaves word of it until seen.
  const [ended, setEnded] = useState<Run>();
  const { run, setRun, start, stop } = useRun((r) => {
    if (leaving.current) return;
    if (r.id !== viewingNow.current) setEnded(r);
    setHistory((h) => remember(h, r, HISTORY));
    setLedger((l) => charge(l, r));
    const before = spentOver(ledgerNow.current, 1).dollars;
    if (!r.unsent && budgetNow.current > 0 && before < budgetNow.current && before + runSpend(r) >= budgetNow.current) toast(`Today's spend has passed your daily budget of ${dollars(budgetNow.current)}`, "warn");
    // A server that could not be reached, or stopped answering mid-run, is looked for again.
    if (r.unsent === "offline" || r.end?.error?.startsWith("the UI server")) checkHealth();
    const outcome = OUTCOME[outcomeOf(r)].label;
    setSaid(`${outcome}: ${r.request.question}. ${secs(r.end?.ms ?? 0)}, ${dollars(runSpend(r))}.`);
    if (document.hidden) {
      setBadge(outcome);
      if (notifyNow.current && "Notification" in window && Notification.permission === "granted") new Notification(`jev: ${outcome}`, { body: r.request.question, tag: r.id }).onclick = () => window.focus();
    }
  });
  const runNow = useRef(run);
  runNow.current = run;

  /** Scans or runs a source again; one that fails keeps the list it had, with why it could not be refreshed. */
  const rescan = useCallback(async (dir: string) => {
    const before = scansNow.current[dir];
    setScans((s) => ({ ...s, [dir]: undefined }));
    const scan = await scanOf(dir);
    if (scan.error === OFFLINE) checkHealth();
    const kept = scan.error && before?.files.length ? { ...before, error: undefined, warning: `could not refresh (${scan.error}); showing the list from before` } : scan;
    setScans((s) => ({ ...s, [dir]: kept }));
  }, [checkHealth]);

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

  // The server is looked for while the page is seen, so the header never says it is ready once it has gone:
  // often while it is away, now and then while it answers, and whenever the tab is looked at again.
  const down = health === "down";
  useEffect(() => {
    const look = () => !document.hidden && checkHealth();
    const id = setInterval(look, down ? 5000 : 15000);
    document.addEventListener("visibilitychange", look);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", look);
    };
  }, [down, checkHealth]);

  // A server back from being away, or started afresh, serves no PDF it has not listed, so every source is listed again.
  const served = useRef<{ down: boolean; boot?: number }>({ down: false });
  useEffect(() => {
    if (!health) return;
    if (health === "down") {
      served.current.down = true;
      return;
    }
    const again = served.current.down || (served.current.boot !== undefined && served.current.boot !== health.boot);
    served.current = { down: false, boot: health.boot };
    if (again) for (const f of folders) rescan(f);
  }, [health]);

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

  const live = run?.status === "running";

  // Leaving mid-run is asked about first; once the page goes, the run is kept as stopped with what it had logged.
  useEffect(() => {
    if (!live) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [live]);
  useEffect(() => {
    // No render follows pagehide, so the run goes straight into storage.
    const save = () => {
      const r = runNow.current;
      if (r?.status !== "running") return;
      leaving.current = true;
      const left = leftRun(r, Date.now());
      writeStored("jev.history", remember(readStored<Run[]>("jev.history", []), left, HISTORY));
      writeStored("jev.ledger", charge(readStored("jev.ledger", NO_SPEND), left));
    };
    // A page brought back from the back-forward cache is not leaving after all.
    const back = (e: PageTransitionEvent) => {
      if (e.persisted) leaving.current = false;
    };
    window.addEventListener("pagehide", save);
    window.addEventListener("pageshow", back);
    return () => {
      window.removeEventListener("pagehide", save);
      window.removeEventListener("pageshow", back);
    };
  }, []);

  /** Moves the cursor into the question, selecting `select` in it, or all of it for true; the drawer, if open, gives way. */
  const focusQuestion = (select?: string | true) => {
    setDrawer(false);
    setFocus((f) => ({ n: f.n + 1, select }));
  };

  /** The welcome page, with the question selected to type over, so what was in it is kept until something replaces it. */
  const home = () => {
    view(null);
    setNote(undefined);
    main.current?.scrollTo({ top: 0 });
    focusQuestion(true);
  };

  // One run at a time: starting another aborts the live one, and that is Stop's job, never a side effect.
  const ask = (request: RunRequest) => {
    if (live) {
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
  // The address names a run this browser does not have: another's link, or one deleted since.
  const missing = viewingId !== null && !shown;
  // Word of a finished run goes once it is on screen, or gone from the history.
  const endedShown = ended && ended.id !== shown?.id && history.some((r) => r.id === ended.id) ? ended : undefined;

  // An answer that arrives below the fold is scrolled up under the header; the
  // page is only tall enough to scroll once it is there.
  useEffect(() => {
    const [el, box] = [runView.current, main.current];
    if (run?.status !== "done" || shown?.id !== run.id || !el || !box) return;
    const below = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    if (below + ANSWER_ROOM > box.clientHeight) box.scrollTo({ top: Math.max(0, below + box.scrollTop - 12), behavior: "smooth" });
  }, [run?.id, run?.status]);

  const cacheWhy = tool !== "jevgrep" && options.cache !== "off" && health && health !== "down" ? health.cache[options.cache] : null;
  const offline = health === "down";
  const target = () => (tool === "jevsec" ? { pdf } : { paths: files.map((f) => f.path) });
  const blocked = whyBlocked({ tool, question, options, pdf: pdf || undefined, files, cacheWhy: cacheWhy ?? undefined, offline });
  const askNow = () => {
    if (live || blocked) return;
    ask({ tool, question: question.trim(), options, ...target() });
  };

  /** Adds the folder or locate command, or says why not: one that lists no PDFs never goes on the shelf. */
  const addFolder = async (input: string): Promise<string | undefined> => {
    const scan = await scanOf(input);
    if (scan.error === OFFLINE) checkHealth();
    if (scan.error) return scan.error === "not a folder" ? `${scan.dir} is not a folder` : /ENOENT/.test(scan.error) ? `${scan.dir} does not exist` : scan.error;
    if (scan.files.length === 0) {
      if (!isLocate(input)) return `No PDFs under ${scan.dir}, so it stays off the shelf`;
      const hint = locateHint(input);
      return `${scan.dir} lists no PDFs that exist, so it stays off the shelf${hint ? `: ${hint}` : ""}`;
    }
    setScans((s) => ({ ...s, [scan.dir]: scan }));
    setFolders((f) => (f.includes(scan.dir) ? f : [...f, scan.dir]));
    toast(`${plural(scan.files.length, "PDF")} on the shelf from ${scan.dir}`);
  };

  // Its scan is kept, so Undo puts the source back as it was, where it was, with the PDF picked from it.
  const removeFolder = (dir: string) => {
    const at = folders.indexOf(dir);
    const picked = pdf;
    setFolders((f) => f.filter((x) => x !== dir));
    toast(`${dir} taken off the shelf`, "ok", {
      label: "Undo",
      run: () => {
        setFolders((f) => (f.includes(dir) ? f : [...f.slice(0, at), dir, ...f.slice(at)]));
        if (picked) setPdf((p) => p || picked);
        toast(`${dir} is back on the shelf`);
      },
    });
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

  /** Restores a run's question and options into the form; a PDF no longer on the shelf is said to be gone. */
  const edit = (r: Run) => {
    const restored = { ...DEFAULTS, ...r.request.options };
    const diff = changed(r.request.tool, restored);
    const lost = r.request.pdf && !files.some((f) => f.path === r.request.pdf) ? r.request.pdf : undefined;
    setTool(r.request.tool);
    setQuestion(r.request.question);
    setOptions(restored);
    if (r.request.pdf && !lost) setPdf(r.request.pdf);
    const options = diff.length ? diff.map((d) => `${d.label} ${String(restored[d.key])}`).join(", ") : "every option at its default";
    setNote(`Restored from that run: ${options}.${lost ? ` Its PDF, ${basename(lost)}, is no longer on the shelf: pick another, or add its folder back.` : ""}`);
    main.current?.scrollTo({ top: 0, behavior: "smooth" });
    focusQuestion();
  };

  /** Puts `removed` back in the history, and the run that was on screen back on it if nothing else has been opened since. */
  const undoRemoval = (removed: Run[], was: string | null, now: string | null, said: string) => ({
    label: "Undo",
    run: () => {
      setHistory((h) => restore(h, removed, HISTORY));
      if (was && viewingNow.current === now) view(was, false);
      toast(said);
    },
  });

  // Clearing keeps what is pinned or still going; the run on screen, if cleared, gives way to the newest one kept.
  const clearHistory = () => {
    const keep = new Set(history.filter((r) => r.pinned).map((r) => r.id));
    if (live && run) keep.add(run.id);
    const removed = history.filter((r) => !keep.has(r.id));
    if (removed.length === 0) {
      toast("Nothing to clear: every run is pinned or running");
      return;
    }
    const now = viewingId && !keep.has(viewingId) ? (byTime(history.filter((r) => keep.has(r.id)))[0]?.id ?? null) : viewingId;
    setHistory((h) => h.filter((r) => keep.has(r.id)));
    if (run && !keep.has(run.id)) setRun(undefined);
    if (now !== viewingId) view(now, false);
    toast(`${plural(removed.length, "run")} cleared${keep.size ? ", but for what is pinned or running" : ""}`, "ok", undoRemoval(removed, viewingId, now, "History restored"));
  };

  // The run on screen, once deleted, gives way to the one that takes its place in the sidebar.
  const deleteRun = (id: string) => {
    const gone = history.find((r) => r.id === id);
    if (!gone) return;
    const now = viewingId === id ? (successor(ordered(history), id)?.id ?? null) : viewingId;
    setHistory((h) => h.filter((r) => r.id !== id));
    if (run?.id === id) setRun(undefined);
    if (now !== viewingId) view(now, false);
    toast("Run deleted", "ok", undoRemoval([gone], viewingId, now, "Run restored"));
  };

  const pinRun = (id: string) => setHistory((h) => h.map((r) => (r.id === id ? { ...r, pinned: !r.pinned } : r)));

  const canNotify = "Notification" in window;
  const setNotifyAsking = async (on: boolean) => {
    if (on && (!canNotify || (Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted"))) {
      toast(canNotify ? "This site is not allowed to show notifications" : "This browser cannot show notifications", "warn");
      setNotify(false);
      return;
    }
    setNotify(on);
    toast(on ? "You will be told when a run ends while the tab is in the background" : "Desktop notifications off");
  };

  const toggleSide = () => (narrow ? setDrawer((d) => !d) : setSidebar((s) => !s));

  /** Opens the sidebar on the shelf, with the cursor where a source is added. */
  const showShelf = () => {
    setSide("shelf");
    if (narrow) setDrawer(true);
    else setSidebar(true);
    requestAnimationFrame(() => document.getElementById("shelf-add")?.focus());
  };

  /** Starts a question from an example of its kind, its gap selected to type over; the file names mode reads no answers, so it gives way. */
  const example = (template: string) => {
    setQuestion(template);
    const across = KIND_HINTS.find((k) => k.template === template)?.kind === "across";
    if (tool === "jevgrep" || (across && tool !== "jevfind")) {
      setTool("jevfind");
      setNote(across ? "Switched to the whole shelf: a table across the shelf asks every document it names." : "Switched to the whole shelf: the file names mode ranks names and reads no answer.");
    }
    focusQuestion("…");
  };

  /** Shows the run older (1) or newer (-1) than the one on screen, in the order they were asked. */
  const step = (by: 1 | -1) => {
    const next = stepFrom(history, shown?.id, by);
    if (next) open(next);
  };

  // Subscribed once; each keystroke reaches the handler of the latest render.
  const onKeyNow = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyNow.current = (e: KeyboardEvent) => {
    // A popover or dialog that took the key has done with it; one this page did not open, a page zoomed, keeps every key.
    if (e.defaultPrevented || (!dialog && document.querySelector('[role="dialog"][aria-modal="true"]'))) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setDialog((d) => (d === "palette" ? undefined : "palette"));
      return;
    }
    // The drawer shuts on Escape from anywhere in it, a text field too, before any run is stopped.
    if (e.key === "Escape" && narrow && drawer && !dialog) {
      e.preventDefault();
      setDrawer(false);
      return;
    }
    if (dialog || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "/") focusQuestion();
    else if (e.key === "n") home();
    else if (e.key === "?") setDialog("shortcuts");
    else if (e.key === "b") toggleSide();
    else if (e.key === "[") step(1);
    else if (e.key === "]") step(-1);
    else if (e.key === "Escape" && live) stop();
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onKeyNow.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sideOpen = narrow ? drawer : sidebar;
  const covered = narrow && drawer;
  useFocusInside(aside, covered);
  useTabTrap(aside, covered && !dialog);

  const items = (): Item[] => {
    const act = (id: string, label: string, run: () => void, extra: Partial<Item> = {}): Item => ({ id, group: "Actions", label, run, ...extra });
    const modes: { tool: Tool; label: string }[] = [
      { tool: "jevfind", label: "Ask the whole shelf" },
      { tool: "jevsec", label: "Ask one PDF" },
      { tool: "jevgrep", label: "Rank the file names" },
    ];
    const clearable = history.filter((r) => !r.pinned).length;
    return [
      live ? act("stop", "Stop the run", stop, { shortcut: "esc" }) : act("ask", "Ask", askNow, { hint: `“${question.trim()}”`, disabled: blocked, shortcut: "⏎" }),
      act("home", "New question", home, { shortcut: "n", hint: shown || missing ? "leaves this run for the welcome page" : undefined, keywords: "home welcome start fresh" }),
      act("focus", "Type a question", () => focusQuestion(), { shortcut: "/" }),
      ...(shown && shown.status !== "running"
        ? [
            act("again", "Ask again, with that run's question and options", () => edit(shown)),
            act("json", "Save the run as JSON", () => {
              const name = `jev-${fileStem(shown.request.question)}.json`;
              download(name, runJson(shown), "application/json");
              toast(`Saved ${name}`);
            }),
            act("link", "Copy a link to this run", async () => toast((await copy(location.href)) ? "Link copied. It opens this run only in this browser, which keeps the history" : "Could not reach the clipboard"), { hint: "opens only in this browser" }),
          ]
        : []),
      ...THEMES.map((t) => act(`theme-${t}`, `Theme: ${THEME_LABEL[t]}`, () => setTheme(t), { hint: t === theme ? "current" : undefined, keywords: `appearance mode colour ${t === "system" ? "auto os" : ""}` })),
      act("sidebar", sideOpen ? "Hide the sidebar" : "Show the sidebar", toggleSide, { shortcut: "b" }),
      ...(canNotify ? [act("notify", notify ? "Turn desktop notifications off" : "Turn desktop notifications on", () => setNotifyAsking(!notify), { keywords: "notify alert background" })] : []),
      act("keys", "Keyboard shortcuts", () => setDialog("shortcuts"), { shortcut: "?" }),
      act("clear", "Clear the history", clearHistory, { disabled: clearable ? undefined : history.length ? "every run in it is pinned" : "the history is empty" }),
      ...modes.map<Item>((m) => ({ id: `mode-${m.tool}`, group: "Mode", label: m.label, hint: m.tool === tool ? `${m.tool}, current` : m.tool, run: () => setTool(m.tool) })),
      ...files.map<Item>((f) => ({
        id: `pdf-${f.path}`,
        group: "Ask one PDF",
        label: f.name,
        path: dirname(f.path),
        run: () => {
          pick(f.path);
          focusQuestion();
        },
      })),
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
          focusQuestion();
        },
      })),
    ];
  };

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
        live={live && run ? { dollars: runSpend(run), in: spendOf(run.lines).in } : undefined}
        budget={budget}
        onBudget={setBudget}
        onRefresh={checkHealth}
        onResetSpend={() => setLedger(NO_SPEND)}
        sidebar={sideOpen}
        onSidebar={toggleSide}
        theme={theme}
        onTheme={setTheme}
        onPalette={() => setDialog("palette")}
        onHome={home}
        notify={notify}
        onNotify={setNotifyAsking}
        inert={covered}
      />
      <div className="relative flex min-h-0 flex-1">
        {covered && <div className="fixed inset-0 z-30 animate-fade bg-black/40" onClick={() => setDrawer(false)} />}
        <aside
          ref={aside}
          inert={!sideOpen}
          aria-label="Sidebar"
          className={cx(
            "flex w-64 shrink-0 flex-col border-r border-stone-200 bg-stone-50 xl:w-80",
            narrow ? cx("fixed top-14 bottom-0 left-0 z-40 w-72 shadow-2xl transition-transform duration-200 ease-out", drawer ? "translate-x-0" : "-translate-x-full") : !sidebar && "hidden",
          )}
        >
          <div className="flex items-end gap-1 border-b border-stone-200 px-3 pt-2">
            <div role="tablist" aria-label="Sidebar" className="flex gap-1">
              {(["shelf", "history"] as const).map((s) => (
                <button
                  key={s}
                  id={`side-tab-${s}`}
                  role="tab"
                  aria-selected={side === s}
                  aria-controls="side-panel"
                  aria-label={s === "shelf" ? `Shelf, ${plural(files.length, "PDF")}` : `History, ${plural(history.length, "run")}`}
                  onClick={() => setSide(s)}
                  className={cx("-mb-px border-b-2 px-2.5 py-2 text-sm font-medium capitalize", side === s ? "border-teal-700 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-800")}
                >
                  {s}
                  <span aria-hidden="true" className="ml-1.5 rounded-full bg-stone-200/70 px-1.5 text-[11px] font-semibold text-stone-600">
                    {s === "shelf" ? files.length : history.length}
                  </span>
                </button>
              ))}
            </div>
            {narrow && (
              <button onClick={() => setDrawer(false)} aria-label="Close the sidebar" className="mb-1 ml-auto flex h-8 w-8 items-center justify-center self-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-800">
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
          <div id="side-panel" role="tabpanel" aria-labelledby={`side-tab-${side}`} className="flex min-h-0 flex-1 flex-col">
            {side === "shelf" ? (
              <Shelf
                folders={folders}
                scans={scans}
                picked={pdf}
                onAdd={addFolder}
                onRemove={removeFolder}
                onRescan={rescan}
                onPick={(p) => {
                  pick(p);
                  if (narrow) focusQuestion();
                }}
              />
            ) : (
              <History runs={history} current={shown?.id} onOpen={open} onClear={clearHistory} onPin={pinRun} onDelete={deleteRun} />
            )}
          </div>
        </aside>

        <main ref={main} inert={covered} className="scroll-thin min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl space-y-5 px-3 py-4 md:px-4 md:py-5 xl:px-6 xl:py-6">
            <Ask
              tool={tool}
              setTool={setTool}
              question={question}
              setQuestion={setQuestion}
              options={options}
              setOptions={setOptions}
              pdf={pdf || undefined}
              onPickPdf={pick}
              onShowShelf={showShelf}
              folders={folders}
              files={files}
              running={live}
              offline={offline}
              onAsk={askNow}
              onStop={stop}
              note={note}
              onDismissNote={() => setNote(undefined)}
              focus={focus}
              cacheWhy={cacheWhy ?? undefined}
              onCacheOffOnce={() => {
                // The cache is the one thing turned off here; anything else that blocks the question still does.
                const why = whyBlocked({ tool, question, options: { ...options, cache: "off" }, pdf: pdf || undefined, files, offline });
                if (why) toast(why, "warn");
                else ask({ tool, question: question.trim(), options: { ...options, cache: "off" }, ...target() });
              }}
              suggestions={recentQuestions(history, question)}
              onExample={example}
            />
            {live && run && shown?.id !== run.id && (
              <button onClick={() => open(run)} className="w-full rounded-xl bg-sky-50 px-4 py-2 text-left text-sm text-sky-800 ring-1 ring-sky-600/20 hover:bg-sky-100">
                A question is still running. Show it →
              </button>
            )}
            {endedShown && (
              <div className="flex items-center gap-3 rounded-xl bg-white px-4 py-2 text-sm ring-1 ring-stone-200">
                <span className={cx("h-2 w-2 rounded-full", OUTCOME[outcomeOf(endedShown)].dot)} />
                <span className="min-w-0 flex-1 truncate text-stone-700">
                  Finished: <span className="font-medium">{OUTCOME[outcomeOf(endedShown)].label}</span> · {dollars(runSpend(endedShown))} · “{endedShown.request.question}”
                </span>
                <button onClick={() => open(endedShown)} className="rounded-md px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50">
                  Show it →
                </button>
                <button onClick={() => setEnded(undefined)} aria-label="Dismiss" className="text-stone-500 hover:text-stone-700">
                  <Icon name="close" size={14} />
                </button>
              </div>
            )}
            {shown ? (
              <div ref={runView}>
                <RunView
                  // Each run opens with its own details folded.
                  key={shown.id}
                  run={shown}
                  onStop={stop}
                  onPick={(p) => {
                    pick(p);
                    main.current?.scrollTo({ top: 0, behavior: "smooth" });
                    focusQuestion();
                  }}
                  // A retry changes this run only; the saved options stay as they are.
                  onRetry={(patch) => ask({ ...shown.request, options: { ...shown.request.options, ...patch } })}
                  onEdit={() => edit(shown)}
                />
              </div>
            ) : missing ? (
              <Notice tone="amber" title="That run isn't in this browser's history">
                A run's link opens only in the browser that asked it, since each browser keeps its own history. It may also have been deleted, or have fallen off the end of the history, which keeps the last {HISTORY} unpinned runs.
                <div className="mt-3 flex flex-wrap gap-2">
                  {history.length > 0 && (
                    <button onClick={() => open(byTime(history)[0]!)} className="rounded-lg bg-stone-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-700">
                      Show the latest run
                    </button>
                  )}
                  <button onClick={home} className="rounded-lg px-3 py-1.5 text-xs font-medium text-amber-900 ring-1 ring-amber-600/40 hover:bg-amber-100">
                    Start a new question
                  </button>
                </div>
              </Notice>
            ) : (
              <Welcome onExample={example} />
            )}
          </div>
        </main>
      </div>
      {dialog === "palette" && <Palette items={items()} onClose={closeDialog} />}
      {dialog === "shortcuts" && <Shortcuts onClose={closeDialog} />}
    </div>
  );
}
