/** The names this server answers to: another name reaching it is a DNS rebinding, a site's name pointed at 127.0.0.1. */
const hosts = (port: number) => [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];

/**
 * Extra names from a comma-separated list, as a proxy in front of the server
 * sends them in Host: "box.tailnet.ts.net:3217", or without a port on 443.
 */
export const namesFrom = (list: string | undefined) =>
  (list ?? "")
    .split(",")
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);

/** Whether the request was addressed to this server by one of its own names, or by a name it was told to answer to. */
export function local(req: Request, port: number, extra: string[] = []): boolean {
  const host = req.headers.get("host")?.toLowerCase() ?? "";
  return hosts(port).includes(host) || extra.includes(host);
}

/**
 * Whether another site's page made this request. A browser marks such a
 * request cross-site, and a page cannot send JSON to another origin without
 * asking first, so what runs a command must be JSON from this UI's own pages.
 * A client outside a browser (curl) sends neither mark and is let through.
 */
export function foreign(req: Request, port: number, extra: string[] = []): boolean {
  if (!local(req, port, extra) || !req.headers.get("content-type")?.startsWith("application/json")) return true;
  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return true;
  const origin = req.headers.get("origin");
  // An extra name sits behind a proxy that may end TLS, so its pages come from https.
  const own = [...hosts(port).map((h) => `http://${h}`), ...extra.flatMap((h) => [`https://${h}`, `http://${h}`])];
  return origin !== null && !own.includes(origin);
}
