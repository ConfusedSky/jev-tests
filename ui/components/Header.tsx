import { useEffect, useState } from "react";
import type { Theme } from "../theme";
import type { Health } from "../types";
import { cx, dollars, tokens } from "../util";

type Check = { label: string; ok: boolean | "off"; detail: string; fix?: string };

function checks(h: Health, cache: string): Check[] {
  const why = h.cache[cache];
  return [
    { label: "OpenRouter key", ok: h.key, detail: h.key ? "jev can be called" : "OPENROUTER_API_KEY is not set, in the environment or in .env", fix: "echo 'OPENROUTER_API_KEY=sk-or-v1-…' > .env" },
    cache === "off"
      ? { label: "Ranking cache", ok: "off", detail: "off: every book is ranked afresh, which costs more tokens" }
      : { label: `Cache · ${cache}`, ok: !why, detail: why ?? "a similar earlier question's ranking is reused", fix: why ? (why.match(/`([^`]+)`/)?.[1] ?? undefined) : undefined },
    { label: "mutool", ok: h.tools.mutool, detail: h.tools.mutool ? "outlines, page layout, highlights and previews" : "mutool (mupdf) is not on PATH", fix: "install mupdf-tools" },
    { label: "pdftotext", ok: h.tools.pdftotext, detail: h.tools.pdftotext ? "the text cache the walk reads" : "pdftotext (poppler) is not on PATH", fix: "install poppler-utils" },
    { label: "ripgrep", ok: h.tools.rg, detail: h.tools.rg ? "the text search for the question's subject" : "rg is not on PATH", fix: "install ripgrep" },
    { label: "tables", ok: h.tools.tables, detail: h.tools.tables ? "pdfplumber reads tables as rows" : "pdfplumber is not installed; tables read as text", fix: "bun run tables:install" },
  ];
}

const dot = (ok: Check["ok"]) => (ok === "off" ? "bg-stone-400" : ok ? "bg-emerald-500" : "bg-amber-500");

const THEME_SAYS: Record<Theme, string> = { system: "follows your system", light: "light", dark: "dark" };

function ThemeIcon({ theme }: { theme: Theme }) {
  const p = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, "aria-hidden": true };
  if (theme === "light")
    return (
      <svg {...p}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  if (theme === "dark")
    return (
      <svg {...p}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  return (
    <svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </svg>
  );
}

type Props = {
  health?: Health;
  cache: string;
  spend: { dollars: number; in: number; runs: number };
  onRefresh: () => void;
  onResetSpend: () => void;
  sidebar: boolean;
  onSidebar: () => void;
  theme: Theme;
  onTheme: () => void;
  onPalette: () => void;
  notify: boolean;
  onNotify: (on: boolean) => void;
};

const iconButton = "flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-800";

export function Header({ health, cache, spend, onRefresh, onResetSpend, sidebar, onSidebar, theme, onTheme, onPalette, notify, onNotify }: Props) {
  // One popover at a time; opening one closes the other.
  const [menu, setMenu] = useState<"status" | "spend">();
  const toggle = (m: "status" | "spend") => setMenu((cur) => (cur === m ? undefined : m));
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(undefined);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);
  const open = menu === "status";
  const ledger = menu === "spend";
  const list = health ? checks(health, cache) : [];
  const issues = list.filter((c) => c.ok === false).length;
  const canNotify = "Notification" in window;
  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-3 border-b border-stone-200 bg-white px-3 md:gap-5 md:px-5">
      {menu && <div className="fixed inset-0 z-10" onClick={() => setMenu(undefined)} />}
      <button onClick={onSidebar} aria-label={sidebar ? "Hide the sidebar" : "Show the sidebar"} aria-pressed={sidebar} title="Sidebar (b)" className={iconButton}>
        <span aria-hidden="true" className="text-lg leading-none">☰</span>
      </button>
      <div className="flex min-w-0 items-baseline gap-2.5">
        <span className="font-serif text-2xl font-semibold tracking-tight text-stone-900">jev</span>
        <span className="hidden truncate text-sm text-stone-500 xl:inline">ask a shelf of PDFs; every answer is the book's own text</span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <button onClick={onPalette} title="Command palette (ctrl K)" className="hidden items-center gap-1.5 rounded-lg border border-stone-200 px-2.5 py-1 text-xs text-stone-500 hover:bg-stone-50 md:flex">
          Search
          <kbd className="rounded bg-stone-100 px-1 font-mono text-[10px]">⌘K</kbd>
        </button>
        <button onClick={onPalette} aria-label="Command palette" className={cx(iconButton, "md:hidden")}>
          ⌕
        </button>
        <button onClick={onTheme} aria-label={`Theme: ${THEME_SAYS[theme]}. Switch`} title={`Theme: ${THEME_SAYS[theme]}`} className={iconButton}>
          <ThemeIcon theme={theme} />
        </button>
      </div>

      <div className="relative z-20">
        <button
          onClick={() => toggle("status")}
          className="flex items-center gap-2 rounded-full border border-stone-200 px-3 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50"
          aria-expanded={open}
        >
          {health ? (
            <>
              <span className="flex -space-x-0.5">
                {list.map((c) => (
                  <span key={c.label} className={cx("h-2 w-2 rounded-full ring-2 ring-white", dot(c.ok))} />
                ))}
              </span>
              <span className="hidden whitespace-nowrap lg:inline">{issues ? `${issues} to fix` : "system ready"}</span>
            </>
          ) : (
            "checking…"
          )}
        </button>
        {open && health && (
          <div className="absolute right-0 top-9 z-20 w-[min(24rem,calc(100vw-1.5rem))] rounded-xl border border-stone-200 bg-white p-2 shadow-xl">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">What the tools need</span>
              <button onClick={onRefresh} className="text-xs text-teal-700 hover:underline">
                check again
              </button>
            </div>
            {list.map((c) => (
              <div key={c.label} className="flex gap-3 rounded-lg px-2 py-2 hover:bg-stone-50">
                <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", dot(c.ok))} />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-stone-800">{c.label}</div>
                  <div className="text-xs text-stone-500">{c.detail}</div>
                  {c.ok === false && c.fix && <code className="mt-1 inline-block rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] text-stone-700">{c.fix}</code>}
                </div>
              </div>
            ))}
            <label className="mt-1 flex items-center gap-3 rounded-lg border-t border-stone-100 px-2 pt-3 pb-1.5 hover:bg-stone-50">
              <input type="checkbox" checked={notify} disabled={!canNotify} onChange={(e) => onNotify(e.target.checked)} className="accent-teal-700" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-stone-800">Desktop notifications</span>
                <span className="block text-xs text-stone-500">{canNotify ? "when a run ends while this tab is in the background" : "this browser cannot show them"}</span>
              </span>
            </label>
            <div className="border-t border-stone-100 px-2 pt-2 pb-1 font-mono text-[11px] text-stone-400">cache: {health.cacheDir}</div>
          </div>
        )}
      </div>

      <div className="relative z-20 border-l border-stone-200 pl-3 md:pl-5">
        <button onClick={() => toggle("spend")} aria-expanded={ledger} className="flex items-center gap-3 rounded-lg px-2 py-1 text-xs whitespace-nowrap text-stone-500 hover:bg-stone-50">
          <span>
            <span className="font-semibold tabular-nums text-stone-800">{dollars(spend.dollars)}</span> <span className="hidden sm:inline">spent</span>
          </span>
          <span className="hidden tabular-nums lg:inline">{tokens(spend.in)} tokens in</span>
          <span className="hidden tabular-nums lg:inline">
            {spend.runs} run{spend.runs === 1 ? "" : "s"}
          </span>
        </button>
        {ledger && (
          <div className="absolute right-0 top-9 z-20 w-72 rounded-xl border border-stone-200 bg-white p-4 text-xs text-stone-600 shadow-xl">
            <div className="mb-1 text-sm font-semibold text-stone-800">What this browser has spent</div>
            <p className="leading-relaxed">
              {dollars(spend.dollars)} over {spend.runs} run{spend.runs === 1 ? "" : "s"}, {spend.in.toLocaleString("en-US")} tokens in. jev charges $0.042 per million tokens in; output is free. Clearing the history keeps this count.
            </p>
            <button
              onClick={() => {
                onResetSpend();
                setMenu(undefined);
              }}
              className="mt-3 rounded-md px-2 py-1 font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50"
            >
              Reset to $0
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
