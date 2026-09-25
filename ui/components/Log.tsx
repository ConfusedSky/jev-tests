import { useEffect, useMemo, useRef, useState } from "react";
import { isFrame, isTotal, spendOf, tree, withoutCost, type Line, type Node } from "../log";
import { copy, cx, dollars, tokens } from "../util";
import { Action, Actions, Icon } from "./Icon";
import { useToast } from "./Toast";

const VERB: Record<string, string> = {
  take: "bg-emerald-100 text-emerald-800",
  keep: "bg-amber-100 text-amber-800",
  drop: "bg-rose-100 text-rose-700",
  yes: "bg-emerald-50 text-emerald-700",
  no: "text-stone-500",
  toc: "bg-sky-100 text-sky-800",
  excerpt: "bg-violet-50 text-violet-700",
  "--": "text-stone-500",
};

function Cost({ line, sum }: { line: Line; sum?: boolean }) {
  if (!line.cost && line.secs === undefined) return null;
  return (
    <span className={cx("ml-auto flex shrink-0 items-center gap-2 pl-3 font-mono text-[11px] tabular-nums", sum ? "text-stone-600" : "text-stone-500")}>
      {line.secs !== undefined && <span>{line.secs.toFixed(1)}s</span>}
      {line.cost && (
        <span className={cx("rounded px-1", sum ? "bg-stone-200/70" : "bg-stone-100")} title={`${line.cost.in.toLocaleString()} tokens in, ${line.cost.out.toLocaleString()} out`}>
          {tokens(line.cost.in)} · {dollars(line.cost.dollars)}
        </span>
      )}
    </span>
  );
}

/** A tool's own message is a failure only when the run failed; "no answer reached p=0.7; best follows" is an outcome like any other. */
function Text({ line, failed }: { line: Line; failed: boolean }) {
  const t = withoutCost(line.text);
  const verb = line.verb && VERB[line.verb] !== undefined ? line.verb : undefined;
  const rest = verb ? t.slice(verb.length).trimStart() : t;
  return (
    <span className={cx("min-w-0 break-words", line.message ? (failed ? "font-semibold text-rose-700" : "font-semibold text-stone-900") : "text-stone-700")}>
      {verb && <span className={cx("mr-1.5 inline-block rounded px-1 text-[11px] font-semibold", VERB[verb])}>{verb}</span>}
      {rest.split(/(p=\d\.\d\d)/).map((s, i) => (/^p=/.test(s) ? <span key={i} className="text-stone-500 tabular-nums">{s}</span> : s))}
    </span>
  );
}

function Row({ node, isOpen, toggle, depth, failed }: { node: Node; isOpen: (i: number) => boolean; toggle: (i: number) => void; depth: number; failed: boolean }) {
  const has = node.children.length > 0;
  const shut = has && !isOpen(node.index);
  const shown = shut && node.sum ? node.sum : node.line;
  return (
    <>
      <div className={cx("group flex items-start gap-1 rounded px-1 py-0.5 hover:bg-stone-100/70", node.line.message && (failed ? "bg-rose-50" : "bg-stone-100"))} style={{ paddingLeft: `${depth * 16 + 4}px` }}>
        <span className="w-10 shrink-0 pt-px text-right font-mono text-[10px] tabular-nums text-stone-500">+{(node.line.t / 1000).toFixed(1)}</span>
        {has ? (
          <button onClick={() => toggle(node.index)} className="w-4 shrink-0 text-[9px] text-stone-500 hover:text-stone-700" aria-label={shut ? "expand" : "collapse"}>
            <Icon name="chevron" size={11} className={cx("inline-block transition-transform", !shut && "rotate-90")} />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <Text line={node.line} failed={failed} />
        {has && shut && (
          <span className="ml-1 shrink-0 text-[11px] text-stone-500">
            {node.children.length} line{node.children.length === 1 ? "" : "s"}
          </span>
        )}
        <Cost line={shown} sum={!!node.sum && shown === node.sum} />
      </div>
      {has && !shut && (
        <>
          {node.children.map((c) => (
            <Row key={c.index} node={c} isOpen={isOpen} toggle={toggle} depth={depth + 1} failed={failed} />
          ))}
          {node.sum && (
            <div className="flex items-start gap-1 rounded px-1 py-0.5" style={{ paddingLeft: `${depth * 16 + 4}px` }}>
              <span className="w-10 shrink-0 pt-px text-right font-mono text-[10px] tabular-nums text-stone-500">+{(node.sum.t / 1000).toFixed(1)}</span>
              <span className="w-4 shrink-0 text-center text-[11px] text-stone-500">Σ</span>
              <span className="min-w-0 text-stone-500">{withoutCost(node.sum.text)}</span>
              <Cost line={node.sum} sum />
            </div>
          )}
        </>
      )}
    </>
  );
}

/**
 * The tool's stderr as a tree: a step's lines under it, its sum beside it,
 * each line's tokens and dollars. A crash's code frame and stack are no steps
 * of the run, so they are left out here and kept for copy and export.
 */
export function Log({ lines, live, trying, failed = false }: { lines: Line[]; live: boolean; trying?: string; failed?: boolean }) {
  const said = useMemo(() => lines.filter((l) => !isFrame(l.text)), [lines]);
  const frames = lines.length - said.length;
  const nodes = useMemo(() => tree(said), [said]);
  // Headers start open; `flipped` holds the ones the user turned the other way.
  const [openByDefault, setOpenByDefault] = useState(true);
  const [flipped, setFlipped] = useState<Set<number>>(new Set());
  const box = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const spend = spendOf(lines);
  // Steps that print no count of their own leave the total larger than its parts.
  const unitemized = lines.some(isTotal) ? spend.in - spendOf(lines.filter((l) => !isTotal(l))).in : 0;
  const isOpen = (i: number) => openByDefault !== flipped.has(i);
  const toggle = (i: number) =>
    setFlipped((f) => {
      const next = new Set(f);
      if (!next.delete(i)) next.add(i);
      return next;
    });
  const all = (open: boolean) => {
    setOpenByDefault(open);
    setFlipped(new Set());
  };

  // Follows the run inside the log's own box only; moving the page would pull the question out of view.
  useEffect(() => {
    const el = box.current;
    if (live && el) el.scrollTop = el.scrollHeight;
  }, [lines.length, live]);

  return (
    <section className="rounded-2xl border border-stone-200 bg-white/70">
      <div className="flex flex-wrap items-center gap-3 border-b border-stone-100 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-stone-800">Log</h3>
        <span className="text-xs text-stone-500">
          {said.length} line{said.length === 1 ? "" : "s"} · {tokens(spend.in)} tokens in · {tokens(spend.out)} out · {dollars(spend.dollars)}
        </span>
        {frames > 0 && (
          <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600" title="The code frame and stack trace the crash printed. Copy the log, or save the run as JSON, to have them">
            {frames} line{frames === 1 ? "" : "s"} of the crash's trace left out; copy keeps them
          </span>
        )}
        {unitemized > 0 && (
          <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800 ring-1 ring-amber-600/20" title="The total counts tokens that no line above claims; a step logged no count of its own">
            {unitemized.toLocaleString("en-US")} tokens not itemized
          </span>
        )}
        <Actions className="ml-auto">
          <Action icon="down" label="expand all" onClick={() => all(true)} />
          <Action icon="chevron" label="collapse all" onClick={() => all(false)} />
          <Action icon="copy" label="copy" title="Copy the log as the tool printed it" onClick={async () => toast((await copy(lines.map((l) => "  ".repeat(l.depth) + l.text).join("\n"))) ? "Log copied" : "Could not reach the clipboard", "ok")} />
        </Actions>
      </div>
      <div ref={box} className="scroll-thin max-h-[32rem] overflow-y-auto px-2 py-2 font-mono text-xs leading-relaxed">
        {said.length === 0 && !trying && <div className="px-2 py-3 text-stone-500">{live ? "Starting…" : "Nothing was logged."}</div>}
        {nodes.map((n) => (
          <Row key={n.index} node={n} isOpen={isOpen} toggle={toggle} depth={0} failed={failed} />
        ))}
        {live && trying && (
          <div className="flex items-center gap-2 px-1 py-0.5 pl-[3.75rem] text-sky-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
            {trying}
          </div>
        )}
      </div>
    </section>
  );
}
