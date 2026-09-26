#!/usr/bin/env bun
/**
 * The web UI: serves the React app and runs the CLI tools for it, one child
 * process a question, so a run is exactly what the command line would do.
 *
 *   bun ui/server.ts [SOURCE...]   folders, or locate commands such as
 *                                  "plocate '*.pdf'", to put on the shelf at first
 *
 * PORT sets the port (3217). JEV_UI_HOSTS lists more names to answer to, for
 * a proxy in front of it that serves them over https (their pages are taken
 * from https only): JEV_UI_HOSTS=box.tailnet.ts.net:3217 behind
 * `tailscale serve --https=3217 http://127.0.0.1:3217`.
 */
import { realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { CACHE_MODELS, unready } from "../cache";
import { keyFromScriptEnv } from "../shared";
import { cacheDir, highlighted, openAt, pageSizes, pageUrl } from "../pdf";
import index from "./index.html";
import { foreign, local, namesFrom } from "./guard";
import { drain, errorText } from "./log";
import { argsFor } from "./options";
import { capOf, drawingName, PageCache } from "./pagecache";
import { checkMarks, checkRequest } from "./request";
import { isLocate, locateArgs, sourceKey } from "./sources";
import type { Config, DocInfo, Health, RunEvent, RunRequest, Scan } from "./types";

const ROOT = resolve(import.meta.dir, "..");
const SCAN_LIMIT = 5000;
const expand = (p: string) => resolve(p.replace(/^~(?=$|\/)/, homedir()));
const LOCATE_TIMEOUT = 30_000;
const PORT = Number(process.env.PORT ?? 3217);
// Names beyond 127.0.0.1 and localhost to answer to, such as a tailnet name a proxy forwards; each one can run the tools.
const HOSTS = namesFrom(process.env.JEV_UI_HOSTS);
const BOOT = Date.now();
const folders = Bun.argv.slice(2).map((a) => (isLocate(a) ? sourceKey(a) : expand(a)));
const drawings = new PageCache(`${cacheDir()}/ui-pages`, capOf(process.env.JEV_PAGE_CACHE_MB));
const drawingsLoaded = drawings.sweep();

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return undefined;
  }
};

// Only PDFs the UI was shown are served, each checked by its real path so
// ".." and links cannot reach others.
const known = new Set<string>();
const know = (p: string) => {
  const r = real(p);
  if (r) known.add(r);
};
function servable(p: string | null | undefined): string | undefined {
  const r = p ? real(p) : undefined;
  return r && /\.pdf$/i.test(r) && known.has(r) ? r : undefined;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const refused = () => json({ error: "refused: only this UI's own page may ask this server to run a command" }, 403);

/** A handler that answers only when the server is addressed by its own name; see guard.ts. */
const own =
  (handle: (req: Request) => Response | Promise<Response>) =>
  (req: Request): Response | Promise<Response> =>
    local(req, PORT, HOSTS) ? handle(req) : json({ error: `refused: this server answers only to 127.0.0.1 and localhost${HOSTS.length ? ` and ${HOSTS.join(", ")}` : ""}` }, 403);

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
    // Read afresh, since another server may share the directory.
    pages: await drawings.sweep().then(() => ({ bytes: drawings.bytes, cap: drawings.cap })),
    boot: BOOT,
  };
}

/** Why a well-formed request still cannot run: its PDF is not one the shelf shows, or has nothing in it to read. */
function unrunnable(r: RunRequest): string | undefined {
  if (r.tool !== "jevsec") return;
  const pdf = servable(r.pdf);
  if (!pdf) return "choose a PDF from the shelf";
  if (Bun.file(pdf).size === 0) return "this file is empty: there is nothing in it to read";
}

function run(req: Request, r: RunRequest): Response {
  // The UI draws each run's marks itself, from the JSON, so no run copies a book to mark it.
  const own = r.tool === "jevgrep" ? ["--json"] : ["--json", "--no-highlight"];
  const args = [...argsFor(r.tool, r.options), ...own, ...(r.tool === "jevsec" ? [r.pdf!] : []), r.question.trim()];
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
        else if (parsed) end.report = parsed;
      } catch {
        end.error = out;
      }
      // A tool that stops before answering (the cache, the key, a missing file) says why on its last lines.
      if (!end.report && !end.ranked && code !== 0) end.error ??= errorText(said) || `exited with ${code}`;
      send(end);
      if (open) controller.close();
      hangUp();
    },
    cancel: hangUp,
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}

/** Every page's size, per file and mtime: a reader lays out a whole book before it draws any of it. */
const docs = new Map<string, Promise<DocInfo>>();
async function docOf(pdf: string): Promise<DocInfo> {
  const { mtimeMs } = await stat(pdf);
  const key = `${pdf}\0${mtimeMs}`;
  let doc = docs.get(key);
  if (!doc) {
    doc = pageSizes(pdf).then((sizes) => ({ mtime: mtimeMs, pages: Object.values(sizes).map((z): [number, number] => [z.width, z.height]) }));
    docs.set(key, doc);
    doc.catch(() => docs.delete(key));
    // A PDF met at a new mtime has changed; drawings of what it was are no use now.
    void drawingsLoaded.then(() => drawings.forget(pdf, mtimeMs));
  }
  return doc;
}

/** Pages mutool draws at once; scrolling through a book asks for many, and a page scrolled past is no longer wanted. */
const DRAWS = 4;
let drawing = 0;
const waiting: (() => void)[] = [];
async function slot<T>(work: () => Promise<T>): Promise<T> {
  // A slot freed goes straight to the next in line, so no newcomer slips in before it.
  if (drawing < DRAWS) drawing++;
  else await new Promise<void>((go) => waiting.push(go));
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else drawing--;
  }
}

/** A page of a PDF as PNG, kept in the cache (see PageCache) until the PDF changes; its address names the file's mtime, so the browser may keep it too. */
async function page(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pdf = servable(url.searchParams.get("pdf"));
  const n = Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1));
  const w = Math.min(2000, Math.max(200, Math.floor(Number(url.searchParams.get("w")) || 900)));
  if (!pdf) return new Response("not on the shelf", { status: 403 });
  let doc: DocInfo;
  try {
    doc = await docOf(pdf);
  } catch (e) {
    return new Response(e instanceof Error ? e.message : String(e), { status: 500 });
  }
  // mutool draws a page past the end without complaint.
  if (n > doc.pages.length) return new Response(`no page ${n}: the PDF has ${doc.pages.length}`, { status: 404 });
  await drawingsLoaded;
  const name = drawingName(pdf, doc.mtime, n, w);
  const png = `${drawings.dir}/${name}`;
  if (!(await Bun.file(png).exists())) {
    let made: boolean;
    try {
      made = await drawings.make(name, req.signal, (part, wanted) =>
        slot(async () => {
          if (!wanted()) return false;
          const p = Bun.spawn(["mutool", "draw", "-q", "-F", "png", "-w", String(w), "-o", part, pdf, String(n)], { stdout: "ignore", stderr: "pipe" });
          if ((await p.exited) !== 0) throw new Error(await new Response(p.stderr).text());
          return true;
        }),
      );
    } catch (e) {
      return new Response(e instanceof Error ? e.message : String(e), { status: 500 });
    }
    if (!made) return new Response(null, { status: 499 });
  }
  void drawings.use(name, Bun.file(png).size);
  return new Response(Bun.file(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" } });
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
        if (foreign(req, PORT, HOSTS)) return refused();
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
        if (foreign(req, PORT, HOSTS)) return refused();
        const body = (await req.json().catch(() => null)) as { command?: unknown } | null;
        return typeof body?.command === "string" && body.command.trim() ? json(await locate(body.command)) : json({ error: "no command" }, 400);
      },
    },
    "/api/run": {
      POST: async (req) => {
        if (foreign(req, PORT, HOSTS)) return refused();
        const checked = checkRequest(await req.json().catch(() => null));
        if ("error" in checked) return json({ error: checked.error }, 400);
        const why = unrunnable(checked.request);
        return why ? json({ error: why }, 400) : run(req, checked.request);
      },
    },
    "/api/page": own(page),
    "/api/doc": own(async (req) => {
      const pdf = servable(new URL(req.url).searchParams.get("pdf"));
      if (!pdf) return json({ error: "not on the shelf" }, 403);
      try {
        return json(await docOf(pdf));
      } catch (e) {
        return json({ error: `mutool could not read its pages: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}` }, 500);
      }
    }),
    "/api/pdf": own((req) => {
      const path = servable(new URL(req.url).searchParams.get("path"));
      if (!path) return new Response("not on the shelf", { status: 403 });
      return new Response(Bun.file(path), { headers: { "Content-Type": "application/pdf" } });
    }),
    "/api/open": {
      POST: async (req) => {
        if (foreign(req, PORT, HOSTS)) return refused();
        const body = (await req.json().catch(() => null)) as { path?: string; page?: number; marks?: unknown } | null;
        const path = servable(body?.path);
        if (!path) return json({ error: "not on the shelf" }, 403);
        const checked = checkMarks(body?.marks);
        if ("error" in checked) return json({ error: checked.error }, 400);
        // A desktop viewer draws annotations, not these marks, so a copy is marked with them; only now, since a book can run to hundreds of megabytes.
        let view = path;
        if (checked.marks.length > 0) {
          try {
            view = await highlighted(path, checked.marks);
          } catch (e) {
            return json({ error: `could not mark a copy: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}` }, 500);
          }
        }
        try {
          await openAt(pageUrl(view, Math.max(1, Math.floor(Number(body?.page)) || 1)));
        } catch (e) {
          return json({ error: `no PDF viewer could be started: ${e instanceof Error ? e.message : String(e)}` }, 500);
        }
        return json({ ok: true, copy: view !== path });
      },
    },
  },
});

console.log(`jev UI at ${server.url}`);
