import { useState } from "react";
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

export function Header({ health, cache, spend, onRefresh }: { health?: Health; cache: string; spend: { dollars: number; in: number; runs: number }; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const list = health ? checks(health, cache) : [];
  const issues = list.filter((c) => c.ok === false).length;
  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-5 border-b border-stone-200 bg-white px-5">
      <div className="flex items-baseline gap-2.5">
        <span className="font-serif text-2xl font-semibold tracking-tight text-stone-900">jev</span>
        <span className="hidden text-sm text-stone-500 md:inline">ask a shelf of PDFs; every answer is the book's own text</span>
      </div>

      <div className="relative ml-auto">
        <button
          onClick={() => setOpen((o) => !o)}
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
              {issues ? `${issues} to fix` : "system ready"}
            </>
          ) : (
            "checking…"
          )}
        </button>
        {open && health && (
          <div className="absolute right-0 top-9 w-96 rounded-xl border border-stone-200 bg-white p-2 shadow-xl">
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
            <div className="border-t border-stone-100 px-2 pt-2 pb-1 font-mono text-[11px] text-stone-400">cache: {health.cacheDir}</div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 border-l border-stone-200 pl-5 text-xs text-stone-500" title="What this browser's runs have spent; jev charges $0.042 per million input tokens and nothing for output">
        <span>
          <span className="font-semibold tabular-nums text-stone-800">{dollars(spend.dollars)}</span> spent
        </span>
        <span className="tabular-nums">{tokens(spend.in)} tokens</span>
        <span className="tabular-nums">
          {spend.runs} run{spend.runs === 1 ? "" : "s"}
        </span>
      </div>
    </header>
  );
}
