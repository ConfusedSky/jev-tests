import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Extracted text and highlighted copies go to a scratch cache of this run's own, never the user's.
process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), "jev-test-"));
