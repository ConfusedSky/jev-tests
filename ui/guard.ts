/** The names this server answers to: another name reaching it is a DNS rebinding, a site's name pointed at 127.0.0.1. */
const hosts = (port: number) => [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];

/** Whether the request was addressed to this server by one of its own names. */
export function local(req: Request, port: number): boolean {
  return hosts(port).includes(req.headers.get("host")?.toLowerCase() ?? "");
}

/**
 * Whether another site's page made this request. A browser marks such a
 * request cross-site, and a page cannot send JSON to another origin without
 * asking first, so what runs a command must be JSON from this UI's own pages.
 * A client outside a browser (curl) sends neither mark and is let through.
 */
export function foreign(req: Request, port: number): boolean {
  if (!local(req, port) || !req.headers.get("content-type")?.startsWith("application/json")) return true;
  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return true;
  const origin = req.headers.get("origin");
  return origin !== null && !hosts(port).some((h) => origin === `http://${h}`);
}
