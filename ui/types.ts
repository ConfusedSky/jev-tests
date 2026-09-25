import type { JsonReport } from "../cli";
import type { Ranked } from "../shared";
import type { Options, Tool } from "./options";

export type { JsonHit, JsonReport } from "../cli";
export type { Ranked } from "../shared";

export type RunRequest = { tool: Tool; question: string; options: Options; pdf?: string; paths?: string[] };

/** What /api/run streams, a JSON object a line. `t` is milliseconds since the tool started. */
export type RunEvent =
  | { type: "start"; argv: string[] }
  | { type: "log"; line: string; t: number }
  | { type: "trying"; line: string }
  | { type: "beat" }
  | { type: "end"; code: number | null; ms: number; report?: JsonReport; ranked?: Ranked[]; error?: string };

export type ShelfFile = { path: string; name: string; size: number };
/** A source's PDFs; `error` when it listed none because it failed, `warning` when it failed part way and listed some. */
export type Scan = { dir: string; files: ShelfFile[]; ms: number; truncated: boolean; error?: string; warning?: string };

export type Health = {
  key: boolean;
  /** Per cache model, why it cannot run, or null when it can. */
  cache: Record<string, string | null>;
  tools: { mutool: boolean; pdftotext: boolean; rg: boolean; tables: boolean };
  cacheDir: string;
  /** When the server started; one started afresh serves no PDF until the shelf is listed again. */
  boot: number;
};

export type Config = { folders: string[]; root: string };
