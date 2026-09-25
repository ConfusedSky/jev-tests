import { csv, markdown } from "../export";
import { download } from "../util";
import { useToast } from "./Toast";

/** Two small links that save a grid as CSV or Markdown. */
export function GridExport({ grid, stem }: { grid: string[][]; stem: string }) {
  const toast = useToast();
  const save = (ext: "csv" | "md") => {
    download(`${stem}.${ext}`, ext === "csv" ? csv(grid) : markdown(grid), ext === "csv" ? "text/csv" : "text/markdown");
    toast(`Saved ${stem}.${ext}`);
  };
  return (
    <span className="flex gap-0.5 text-[11px]">
      <button onClick={() => save("csv")} title="Save the table as CSV" className="rounded-md px-1.5 py-0.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800">
        csv
      </button>
      <button onClick={() => save("md")} title="Save the table as Markdown" className="rounded-md px-1.5 py-0.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800">
        markdown
      </button>
    </span>
  );
}
