import { csv, markdown } from "../export";
import { download } from "../util";
import { Action, Actions } from "./Icon";
import { useToast } from "./Toast";

/** Two small actions that save a grid as CSV or Markdown, `source` on its last line. */
export function GridExport({ grid, stem, source }: { grid: string[][]; stem: string; source?: string }) {
  const toast = useToast();
  const save = (ext: "csv" | "md") => {
    download(`${stem}.${ext}`, ext === "csv" ? csv(grid, source) : markdown(grid, source), ext === "csv" ? "text/csv" : "text/markdown");
    toast(`Saved ${stem}.${ext}`);
  };
  return (
    <Actions>
      <Action icon="download" label="csv" title="Save the table as CSV, with where it came from" onClick={() => save("csv")} />
      <Action icon="download" label="markdown" title="Save the table as Markdown, with where it came from" onClick={() => save("md")} />
    </Actions>
  );
}
