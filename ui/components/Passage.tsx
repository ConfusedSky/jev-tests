import type { ReactNode } from "react";
import { tableGrid } from "../export";
import type { JsonHit } from "../types";
import { cx } from "../util";
import { GridExport } from "./GridExport";

type Para = NonNullable<NonNullable<JsonHit["answer"]>["passage"]>[number];
type Row = NonNullable<Para["table"]>;

/** Runs of `text` set in one weight: "B" bold italic, "b" bold, "i" italic, " " roman (see layout.ts). */
function Styled({ text, style }: { text: string; style: string }) {
  const runs: { s: string; t: string }[] = [];
  for (let i = 0; i < text.length; i++) {
    const s = style[i] ?? " ";
    const last = runs[runs.length - 1];
    if (last && last.s === s) last.t += text[i];
    else runs.push({ s, t: text[i]! });
  }
  return (
    <>
      {runs.map((r, i) =>
        r.s === "B" ? (
          <strong key={i} className="font-semibold italic">
            {r.t}
          </strong>
        ) : r.s === "b" ? (
          <strong key={i} className="font-semibold">
            {r.t}
          </strong>
        ) : r.s === "i" ? (
          <em key={i}>{r.t}</em>
        ) : (
          <span key={i}>{r.t}</span>
        ),
      )}
    </>
  );
}

const lone = (r: Row) => r.cells.filter(Boolean).length === 1;

export function Rows({ rows, first, stem = "table" }: { rows: Row[]; first?: boolean; stem?: string }) {
  const keep = rows[0]!.heads.map((_, i) => i).filter((i) => rows.some((r) => !lone(r) && r.cells[i]));
  if (keep.length === 0) return <>{rows.map((r, i) => <p key={i}>{r.cells.find(Boolean)}</p>)}</>;
  return (
    <div className="scroll-thin relative overflow-x-auto rounded-lg ring-1 ring-stone-200">
      <div className="flex justify-end border-b border-stone-100 bg-stone-50 px-1 py-0.5">
        <GridExport grid={tableGrid(rows)} stem={stem} />
      </div>
      <table className="w-full border-collapse font-sans text-[13px]">
        <thead className="bg-stone-50">
          <tr>
            {keep.map((i) => (
              <th key={i} className="border-b border-stone-200 px-3 py-2 text-left text-xs font-semibold whitespace-nowrap text-stone-600">
                {rows[0]!.heads[i]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, n) =>
            lone(r) ? (
              <tr key={n} className="bg-stone-50/60">
                <td colSpan={keep.length} className="border-b border-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-600">
                  {r.cells.find(Boolean)}
                </td>
              </tr>
            ) : (
              <tr key={n} className="hover:bg-teal-50/40">
                {keep.map((i, k) => (
                  <td key={i} className={cx("border-b border-stone-100 px-3 py-1.5 align-top text-stone-800", k === 0 && first !== false && "font-medium")}>
                    {r.cells[i]}
                  </td>
                ))}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

/** A passage as the page sets it: headings, weights, and a table's rows as a table. */
export function Passage({ paras, stem }: { paras: Para[]; stem?: string }) {
  const blocks: ReactNode[] = [];
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i]!;
    if (p.table) {
      const key = p.table.heads.join("\t");
      const rows = [p.table];
      while (paras[i + 1]?.table?.heads.join("\t") === key) rows.push(paras[++i]!.table!);
      blocks.push(<Rows key={i} rows={rows} stem={stem} />);
    } else if (p.heading)
      blocks.push(
        <h4 key={i} className="pt-1 font-sans text-sm font-semibold tracking-wide text-stone-900 uppercase">
          {p.text}
        </h4>,
      );
    else
      blocks.push(
        <p key={i}>
          <Styled text={p.text} style={p.style} />
        </p>,
      );
  }
  return <div className="space-y-3 font-serif text-[15px] leading-relaxed text-stone-800">{blocks}</div>;
}
