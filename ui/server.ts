#!/usr/bin/env bun
/**
 * The web UI: serves the React app and runs the CLI tools for it, one child
 * process a question, so a run is exactly what the command line would do.
 *
 *   bun ui/server.ts [SOURCE...]   folders, or locate commands such as
 *                                  "plocate '*.pdf'", to put on the shelf at first
 */
import { realpathSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { CACHE_MODELS, unready } from "../cache";
import { keyFromScriptEnv } from "../shared";
import { cacheDir, openAt, pageUrl } from "../pdf";
import index from "./index.html";
import { foreign, local } from "./guard";
import { drain } from "./log";
import { argsFor, DEFAULTS, type Tool } from "./options";
import { isLocate, locateArgs, sourceKey } from "./sources";
import type { Config, Health, RunEvent, RunRequest, Scan } from "./types";

const ROOT = resolve(import.meta.dir, "..");
const TOOLS: Tool[] = ["jevsec", "jevfind", "jevgrep"];
const SCAN_LIMIT = 5000;
const expand = (p: string) => resolve(p.replace(/^~(?=$|\/)/, homedir()));
const LOCATE_TIMEOUT = 30_000;
const PORT = Number(process.env.PORT ?? 3217);
const folders = Bun.argv.slice(2).map((a) => (isLocate(a) ? sourceKey(a) : expand(a)));

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return undefined;
  }
};

// Only PDFs the UI was shown or given, and the tools' highlighted copies, are
// served, each checked by its real path so ".." and links cannot reach others.
const known = new Set<string>();
const know = (p: string) => {
  const r = real(p);
  if (r) known.add(r);
};
function servable(p: string | null | undefined): string | undefined {
  const r = p ? real(p) : undefined;
  if (!r || !/\.pdf$/i.test(r)) return undefined;
  const cache = real(cacheDir());
  return known.has(r) || (cache && r.startsWith(`${cache}/`)) ? r : undefined;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const refused = () => json({ error: "refused: only this UI's own page may ask this server to run a command" }, 403);

/** A handler that answers only when the server is addressed by its own name; see guard.ts. */
const own =
  (handle: (req: Request) => Response | Promise<Response>) =>
  (req: Request): Response | Promise<Response> =>
    local(req, PORT) ? handle(req) : json({ error: "refused: this server answers only to 127.0.0.1 and localhost" }, 403);

async function scan(dir: string): Promise<Scan> {
  const t = performance.now();
  const files: Scan["files"] = [];
  let truncated = false;
  try {
    if (!(await stat(dir)).isDirectory()) return { dir, files, ms: 0, truncated, error: "not a folder" };
    for await (const path of new Bun.Glob("**/*.[pP][dD][fF]").scan({ cwd: dir, absolute: true, onlyFiles: true })) {
      if (files.length >= SCAN_LIMIT) {
        truncated = true;
        break;
      }
      files.push({ path, name: path.split("/").pop()!, size: Bun.file(path).size });
      know(path);
    }
  } catch (e) {
    return { dir, files, ms: performance.now() - t, truncated, error: e instanceof Error ? e.message : String(e) };
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { dir, files, ms: performance.now() - t, truncated };
}

/** The PDFs a locate command lists that are still there; it runs without a shell, so it can only be plocate. */
async function locate(command: string): Promise<Scan> {
  const t = performance.now();
  const dir = sourceKey(command);
  const fail = (error: string): Scan => ({ dir, files: [], ms: performance.now() - t, truncated: false, error });
  const parsed = locateArgs(command);
  if ("error" in parsed) return fail(parsed.error);
  const [name, ...args] = parsed.argv;
  const exe = Bun.which(name!);
  if (!exe) return fail(`${name} is not installed, or not on the server's PATH`);
  let out: string, err: string, code: number, killed: boolean;
  try {
    const p = Bun.spawn([exe, ...args], { argv0: name, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => p.kill(), LOCATE_TIMEOUT);
    [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    code = await p.exited;
    clearTimeout(timer);
    killed = !!p.signalCode;
  } catch (e) {
    return fail(`${name} could not be run: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (killed) return fail(`${name} took longer than ${LOCATE_TIMEOUT / 1000}s and was stopped`);
  // The tools' highlighted copies are copies of books, not books of their own.
  const cache = `${cacheDir()}/`;
  const listed = [...new Set(out.split(/[\n\0]/).filter((l) => /\.pdf$/i.test(l) && !l.startsWith(cache)))];
  // plocate exits 1 both when nothing matched, silently, and on a bad option or database, which it explains.
  const why = code === 0 || (code === 1 && !err.trim()) ? undefined : explain(name!, err, code);
  if (why && listed.length === 0) return fail(why);
  // A database can list files deleted since it was built.
  const found = (await Promise.all(listed.slice(0, SCAN_LIMIT).map((path) => stat(path).then((s) => (s.isFile() ? { path, name: path.split("/").pop()!, size: s.size } : undefined), () => undefined)))).filter((f) => f !== undefined);
  for (const f of found) know(f.path);
  found.sort((a, b) => a.path.localeCompare(b.path));
  // Some of its databases read and some not: keep what it listed, and say what went wrong.
  return { dir, files: found, ms: performance.now() - t, truncated: listed.length > SCAN_LIMIT, warning: why };
}

/** A locate failure in a line, the program named and a missing or unreadable database pointed at updatedb. */
function explain(name: string, err: string, code: number): string {
  const line = err.trim().split("\n")[0] ?? "";
  const said = !line ? `${name} exited with ${code}` : line.startsWith(name) ? line : `${name}: ${line}`;
  return /\.db\b|database/i.test(said) ? `${said}. Its database may need building or opening up: sudo updatedb` : said;
}

async function health(): Promise<Health> {
  const cache = Object.fromEntries(await Promise.all(Object.entries(CACHE_MODELS).map(async ([id, m]) => [id, (await unready(m)) ?? null])));
  return {
    key: !!(process.env.OPENROUTER_API_KEY ?? (await keyFromScriptEnv())),
    cache,
    tools: {
      mutool: !!Bun.which("mutool"),
      pdftotext: !!Bun.which("pdftotext"),
      rg: !!Bun.which("rg"),
      tables: await Bun.file(`${ROOT}/.venv/bin/python`).exists(),
    },
    cacheDir: cacheDir(),
  };
}

function bad(r: RunRequest): string | undefined {
  if (typeof r !== "object" || r === null) return "the request must be a JSON object";
  if (!TOOLS.includes(r.tool)) return "unknown tool";
  if (typeof r.question !== "string" || !r.question.trim()) return "ask a question";
  if (r.tool === "jevsec" && !servable(r.pdf)) return "choose a PDF from the shelf";
  if (r.tool !== "jevsec" && (!Array.isArray(r.paths) || r.paths.length === 0)) return "the shelf is empty";
}

function run(req: Request, r: RunRequest): Response {
  const o = { ...DEFAULTS, ...r.options };
  const args = [...argsFor(r.tool, o), "--json", ...(r.tool === "jevsec" ? [r.pdf!] : []), r.question.trim()];
  const proc = Bun.spawn([process.execPath, `${ROOT}/${r.tool}.ts`, ...args], {
    cwd: ROOT,
    env: { ...process.env, JEV_PROGRESS: "1" },
    stdin: r.tool === "jevsec" ? "ignore" : new Blob([`${r.paths!.join("\n")}\n`]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const started = performance.now();
  const enc = new TextEncoder();
  // Once the reader goes (Stop, a closed tab), nothing more may be enqueued:
  // a write to a cancelled stream throws, and from a timer that ends the server.
  let open = true;
  let beat: Timer | undefined;
  const hangUp = () => {
    open = false;
    clearInterval(beat);
    proc.kill();
  };
  req.signal.addEventListener("abort", hangUp);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: RunEvent) => {
        if (open) controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
      };
      // A jev call can outlast the idle timeout with nothing to say.
      beat = setInterval(() => send({ type: "beat" }), 5000);
      send({ type: "start", argv: [`${r.tool}.ts`, ...args] });
      const stdout = new Response(proc.stdout).text();
      const said: string[] = [];
      const emit = (e: { type: "log" | "trying"; line: string }) => {
        if (e.type === "log") said.push(e.line);
        send(e.type === "log" ? { type: "log", line: e.line, t: Math.round(performance.now() - started) } : { type: "trying", line: e.line });
      };
      const dec = new TextDecoder();
      let buf = "";
      for await (const chunk of proc.stderr) buf = drain(buf + dec.decode(chunk, { stream: true }), emit);
      drain(`${buf}\n`, emit);
      const code = await proc.exited;
      const out = (await stdout).trim();
      const end: Extract<RunEvent, { type: "end" }> = { type: "end", code, ms: Math.round(performance.now() - started) };
      try {
        const parsed = out ? JSON.parse(out) : undefined;
        if (Array.isArray(parsed)) end.ranked = parsed;
        else if (parsed) {
          end.report = parsed;
          for (const h of [...parsed.hits, ...(parsed.table?.cells.flat().flatMap((c: { hit?: { view: string } }) => (c.hit ? [c.hit] : [])) ?? [])]) know(h.view);
        }
      } catch {
        end.error = out;
      }
      // A tool that stops before answering (the cache, the key, a missing file) says why on its last lines.
      if (!end.report && !end.ranked && code !== 0) end.error ??= said.slice(-3).join("\n") || `exited with ${code}`;
      send(end);
      if (open) controller.close();
      hangUp();
    },
    cancel: hangUp,
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}

/** How many pages a PDF has, off its page tree, or undefined when that cannot be read; mutool draws a page past the end without complaint. */
const pageCounts = new Map<string, number | undefined>();
async function pageCount(pdf: string, mtimeMs: number): Promise<number | undefined> {
  const key = `${pdf}\0${mtimeMs}`;
  if (!pageCounts.has(key)) {
    const p = Bun.spawn(["mutool", "show", pdf, "trailer/Root/Pages/Count"], { stdout: "pipe", stderr: "ignore" });
    const out = await new Response(p.stdout).text();
    await p.exited;
    const n = Number(out.trim().split("\n").pop());
    pageCounts.set(key, Number.isInteger(n) && n > 0 ? n : undefined);
  }
  return pageCounts.get(key);
}

/** A page of a PDF as PNG, highlights and all, kept in the cache until the PDF changes. */
async function page(url: URL): Promise<Response> {
  const pdf = servable(url.searchParams.get("pdf"));
  const n = Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1));
  const w = Math.min(2000, Math.max(200, Math.floor(Number(url.searchParams.get("w")) || 900)));
  if (!pdf) return new Response("not on the shelf", { status: 403 });
  const { mtimeMs } = await stat(pdf);
  const count = await pageCount(pdf, mtimeMs);
  if (count !== undefined && n > count) return new Response(`no page ${n}: the PDF has ${count}`, { status: 404 });
  const dir = `${cacheDir()}/ui-pages`;
  const png = `${dir}/${Bun.hash(`${pdf}\0${mtimeMs}\0${n}\0${w}`).toString(36)}.png`;
  if (!(await Bun.file(png).exists())) {
    await mkdir(dir, { recursive: true });
    const p = Bun.spawn(["mutool", "draw", "-q", "-F", "png", "-w", String(w), "-o", png, pdf, String(n)], { stdout: "ignore", stderr: "pipe" });
    if ((await p.exited) !== 0) return new Response(await new Response(p.stderr).text(), { status: 500 });
  }
  return new Response(Bun.file(png), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  idleTimeout: 60,
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
  routes: {
    "/": index,
    "/favicon.ico": new Response(null, { status: 204 }),
    "/api/config": own(() => json({ folders, root: ROOT } satisfies Config)),
    "/api/health": own(async () => json(await health())),
    // A scan makes a folder's PDFs servable, so it is asked for as a command is.
    "/api/scan": {
      POST: async (req) => {
        if (foreign(req, PORT)) return refused();
        const body = (await req.json().catch(() => null)) as { dir?: unknown } | null;
        const dir = typeof body?.dir === "string" ? body.dir.trim() : "";
        if (!dir) return json({ error: "no folder" }, 400);
        // A relative path would be read against wherever the server was started.
        if (!/^[~/]/.test(dir)) return json({ dir, files: [], ms: 0, truncated: false, error: "use a full path, starting with / or ~" } satisfies Scan);
        return json(await scan(expand(dir)));
      },
    },
    "/api/locate": {
      POST: async (req) => {
        if (foreign(req, PORT)) return refused();
        const body = (await req.json().catch(() => null)) as { command?: unknown } | null;
        return typeof body?.command === "string" && body.command.trim() ? json(await locate(body.command)) : json({ error: "no command" }, 400);
      },
    },
    "/api/run": {
      POST: async (req) => {
        if (foreign(req, PORT)) return refused();
        const r = (await req.json().catch(() => null)) as RunRequest;
        const why = bad(r);
        return why ? json({ error: why }, 400) : run(req, r);
      },
    },
    "/api/page": own((req) => page(new URL(req.url))),
    "/api/pdf": own((req) => {
      const path = servable(new URL(req.url).searchParams.get("path"));
      if (!path) return new Response("not on the shelf", { status: 403 });
      return new Response(Bun.file(path), { headers: { "Content-Type": "application/pdf" } });
    }),
    "/api/open": {
      POST: async (req) => {
        if (foreign(req, PORT)) return refused();
        const body = (await req.json().catch(() => null)) as { path?: string; page?: number } | null;
        const path = servable(body?.path);
        if (!path) return json({ error: "not on the shelf" }, 403);
        try {
          await openAt(pageUrl(path, Math.max(1, Math.floor(Number(body?.page)) || 1)));
        } catch (e) {
          return json({ error: `no PDF viewer could be started: ${e instanceof Error ? e.message : String(e)}` }, 500);
        }
        return json({ ok: true });
      },
    },
  },
});

console.log(`jev UI at ${server.url}`);
