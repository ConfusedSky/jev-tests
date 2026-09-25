import { useEffect, useRef, useState, type MouseEvent } from "react";
import { PRICE, spentOver, TOOL_LABEL, type Ledger } from "../labels";
import { THEME_LABEL, THEMES, type Theme } from "../theme";
import type { Health } from "../types";
import { cx, dollars, MOD, tokens } from "../util";
import { Icon } from "./Icon";

type Check = { label: string; ok: boolean | "off"; detail: string; fix?: string };

function checks(h: Health, cache: string): Check[] {
  const why = h.cache[cache];
  return [
    { label: "OpenRouter key", ok: h.key, detail: h.key ? "jev can be called" : "OPENROUTER_API_KEY is not set, in the environment or in .env", fix: "echo 'OPENROUTER_API_KEY=sk-or-v1-…' > .env" },
    cache === "off"
      ? { label: "Ranking cache", ok: "off", detail: "off: every PDF is ranked afresh, which costs more tokens" }
      : { label: `Cache · ${cache}`, ok: !why, detail: why ?? "a similar earlier question's ranking is reused", fix: why ? (why.match(/`([^`]+)`/)?.[1] ?? undefined) : undefined },
    { label: "mutool", ok: h.tools.mutool, detail: h.tools.mutool ? "outlines, page layout, highlights and previews" : "mutool (mupdf) is not on PATH", fix: "install mupdf-tools" },
    { label: "pdftotext", ok: h.tools.pdftotext, detail: h.tools.pdftotext ? "the text cache the walk reads" : "pdftotext (poppler) is not on PATH", fix: "install poppler-utils" },
    { label: "ripgrep", ok: h.tools.rg, detail: h.tools.rg ? "the text search for the question's subject" : "rg is not on PATH", fix: "install ripgrep" },
    { label: "tables", ok: h.tools.tables, detail: h.tools.tables ? "pdfplumber reads tables as rows" : "pdfplumber is not installed; tables read as text", fix: "bun run tables:install" },
  ];
}

const dot = (ok: Check["ok"]) => (ok === "off" ? "bg-stone-400" : ok ? "bg-emerald-500" : "bg-amber-500");

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
  /** "down" when the UI server did not answer. */
  health?: Health | "down";
  cache: string;
  spend: Ledger;
  /** What the run going now has spent so far, counted in `spend` once it ends. */
  live?: { dollars: number; in: number };
  /** Dollars a day to be warned past; 0 for none. */
  budget: number;
  onBudget: (dollars: number) => void;
  onRefresh: () => void;
  onResetSpend: () => void;
  sidebar: boolean;
  onSidebar: () => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
  onPalette: () => void;
  notify: boolean;
  onNotify: (on: boolean) => void;
  /** Out of reach while the sidebar covers the page as a drawer. */
  inert?: boolean;
};

const iconButton = "flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-800";

type Menu = "status" | "spend" | "theme";

export function Header({ health, cache, spend, live, budget, onBudget, onRefresh, onResetSpend, sidebar, onSidebar, theme, onTheme, onPalette, notify, onNotify, inert }: Props) {
  // One popover at a time; opening one closes the other.
  const [menu, setMenu] = useState<Menu>();
  const opener = useRef<HTMLElement | null>(null);
  const toggle = (m: Menu, e: MouseEvent<HTMLElement>) => {
    opener.current = e.currentTarget;
    setMenu((cur) => (cur === m ? undefined : m));
  };
  useEffect(() => {
    if (!menu) return;
    // Escape here closes the popover and nothing else: the page's own Escape stops a paid run.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setMenu(undefined);
      opener.current?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [menu]);
  const open = menu === "status";
  const ledger = menu === "spend";
  const down = health === "down";
  const list = health && !down ? checks(health, cache) : [];
  const issues = list.filter((c) => c.ok === false).length;
  const canNotify = "Notification" in window;
  const today = spentOver(spend, 1).dollars + (live?.dollars ?? 0);
  const over = budget > 0 && today >= budget;
  const status = down ? "UI server not running" : !health ? "checking…" : issues ? `${issues} to fix` : "system ready";
  return (
    <header inert={inert} className="relative z-20 flex h-14 shrink-0 items-center gap-3 border-b border-stone-200 bg-white px-3 md:gap-5 md:px-5">
      {menu && <div className="fixed inset-0 z-10" onClick={() => setMenu(undefined)} />}
      <button onClick={onSidebar} aria-label="Sidebar: the shelf and the history" aria-expanded={sidebar} title="Sidebar (b)" className={iconButton}>
        <Icon name="menu" size={18} />
      </button>
      <div className="flex min-w-0 items-baseline gap-2.5">
        <span className="font-serif text-2xl font-semibold tracking-tight text-stone-900">jev</span>
        <span className="hidden truncate text-sm text-stone-500 xl:inline">ask a shelf of PDFs; every answer is the document's own text</span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <button onClick={onPalette} title={`Command palette (${MOD}+K)`} className="hidden items-center gap-1.5 rounded-lg border border-stone-200 px-2.5 py-1 text-xs text-stone-500 hover:bg-stone-50 md:flex">
          Search
          <kbd className="rounded bg-stone-100 px-1 font-mono text-[10px]">{MOD === "⌘" ? "⌘K" : "Ctrl K"}</kbd>
        </button>
        <button onClick={onPalette} aria-label="Command palette" className={cx(iconButton, "md:hidden")}>
          <Icon name="search" size={16} />
        </button>
        <div className="relative z-20">
          <button onClick={(e) => toggle("theme", e)} aria-label={`Theme: ${THEME_LABEL[theme]}`} aria-haspopup="true" aria-expanded={menu === "theme"} title={`Theme: ${THEME_LABEL[theme]}`} className={iconButton}>
            <ThemeIcon theme={theme} />
          </button>
          {menu === "theme" && (
            <div role="group" aria-label="Theme" className="absolute right-0 top-9 z-20 w-52 rounded-xl border border-stone-200 bg-white p-1.5 shadow-xl">
              {THEMES.map((t) => (
                // A click picks and closes, picking itself since the menu is gone before the radio would hear of it; arrow keys (a click of detail 0) move through the choices and leave it open.
                <label
                  key={t}
                  onClick={(e) => {
                    if (e.detail === 0) return;
                    onTheme(t);
                    setMenu(undefined);
                    opener.current?.focus();
                  }}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-stone-700 hover:bg-stone-50 has-[:checked]:bg-teal-50 has-[:checked]:font-medium has-[:checked]:text-teal-900">
                  <input type="radio" name="theme" value={t} checked={theme === t} onChange={() => onTheme(t)} autoFocus={theme === t} className="accent-teal-700" />
                  <ThemeIcon theme={t} />
                  {THEME_LABEL[t]}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="relative z-20">
        <button
          onClick={(e) => toggle("status", e)}
          aria-label={`What the tools need: ${status}`}
          className="flex items-center gap-2 rounded-full border border-stone-200 px-3 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50"
          aria-expanded={open}
        >
          {/* One dot for the whole: rose when the server is gone, amber when something needs fixing, green when all is ready. */}
          <span className={cx("h-2 w-2 shrink-0 rounded-full", down ? "bg-rose-500" : !health ? "animate-pulse bg-stone-400" : issues ? "bg-amber-500" : "bg-emerald-500")} />
          <span className={cx("hidden whitespace-nowrap lg:inline", down && "text-rose-700")}>{status}</span>
        </button>
        {open && down && (
          <div className="absolute right-0 top-9 z-20 w-[min(24rem,calc(100vw-1.5rem))] rounded-xl border border-stone-200 bg-white p-4 text-xs text-stone-600 shadow-xl">
            <div className="mb-1 text-sm font-semibold text-rose-800">The UI server is not running</div>
            <p className="leading-relaxed">
              This page cannot reach it, so nothing can be asked. Start it again from the repo with <code className="rounded bg-stone-100 px-1 font-mono text-[11px] text-stone-700">bun run ui</code>; the page checks every few seconds and picks up where it was.
            </p>
            <button onClick={onRefresh} className="mt-2 text-xs text-teal-700 hover:underline">
              check again now
            </button>
          </div>
        )}
        {open && health && !down && (
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
            <div className="border-t border-stone-100 px-2 pt-2 pb-1 font-mono text-[11px] text-stone-500">cache: {health.cacheDir}</div>
          </div>
        )}
      </div>

      <div className="relative z-20 border-l border-stone-200 pl-3 md:pl-5">
        <button
          onClick={(e) => toggle("spend", e)}
          aria-expanded={ledger}
          title={[live && `Includes ${dollars(live.dollars)} from the run going now`, over && `Today's spend, ${dollars(today)}, is past the daily budget of ${dollars(budget)}`].filter(Boolean).join(". ") || undefined}
          className="flex items-center gap-3 rounded-lg px-2 py-1 text-xs whitespace-nowrap text-stone-500 hover:bg-stone-50"
        >
          <span className="flex items-center gap-1.5">
            {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" aria-hidden="true" />}
            <span className={cx("font-semibold tabular-nums", over ? "text-amber-700" : "text-stone-800")}>{dollars(spend.dollars + (live?.dollars ?? 0))}</span> <span className="hidden sm:inline">spent</span>
          </span>
          <span className="hidden tabular-nums lg:inline">{tokens(spend.in + (live?.in ?? 0))} tokens in</span>
          <span className="hidden tabular-nums lg:inline">
            {spend.runs} run{spend.runs === 1 ? "" : "s"}
          </span>
        </button>
        {ledger && (
          <div className="absolute right-0 top-9 z-20 w-[min(20rem,calc(100vw-1.5rem))] rounded-xl border border-stone-200 bg-white p-4 text-xs text-stone-600 shadow-xl">
            <div className="mb-1 text-sm font-semibold text-stone-800">What this browser has spent</div>
            <p className="leading-relaxed">
              {dollars(spend.dollars)} over {spend.runs} run{spend.runs === 1 ? "" : "s"}, {spend.in.toLocaleString("en-US")} tokens in{live ? `, and ${dollars(live.dollars)} so far on the run going now` : ""}.
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-stone-50 px-3 py-2">
              <dt className="text-stone-500">today</dt>
              <dd className={cx("font-mono tabular-nums", over ? "font-semibold text-amber-800" : "text-stone-800")}>
                {dollars(today)}
                {budget > 0 && <span className="font-sans font-normal text-stone-500"> of {dollars(budget)} a day</span>}
              </dd>
              <dt className="text-stone-500">last 7 days</dt>
              <dd className="font-mono tabular-nums text-stone-800">{dollars(spentOver(spend, 7).dollars + (live?.dollars ?? 0))}</dd>
              <dt className="text-stone-500">last 30, by mode</dt>
              <dd className="text-stone-800">
                {(() => {
                  const t = spentOver(spend, 30).tools;
                  return (["jevfind", "jevsec", "jevgrep"] as const).map((k, i) => (
                    <span key={k}>
                      {i > 0 && " · "}
                      {TOOL_LABEL[k]} <span className="font-mono tabular-nums">{dollars(t[k])}</span>
                    </span>
                  ));
                })()}
              </dd>
            </dl>
            {over && <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 font-medium text-amber-900 ring-1 ring-amber-600/20">Today's spend is past the daily budget.</p>}
            <Budget budget={budget} onBudget={onBudget} />
            <p className="mt-2 leading-relaxed text-stone-500">
              jev charges {PRICE}; output is free. Clearing the history keeps this count. A run stopped, or left by closing or reloading the page, counts every call that had finished; one still in flight is billed but never reported, so it is not here.
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

/** The daily budget as typed: the field keeps its own text, so "0." on the way to "0.05" is not wiped by the page's next render. */
function Budget({ budget, onBudget }: { budget: number; onBudget: (dollars: number) => void }) {
  const [text, setText] = useState(budget ? String(budget) : "");
  return (
    <label className="mt-2 flex items-center gap-2">
      <span className="text-stone-500">Warn past a day's spend of $</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        placeholder="none"
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          onBudget(Number.isFinite(n) && n > 0 ? n : 0);
        }}
        className="w-20 rounded-md border border-stone-200 bg-white px-1.5 py-0.5 font-mono tabular-nums placeholder:font-sans placeholder:text-stone-500 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
      />
    </label>
  );
}
