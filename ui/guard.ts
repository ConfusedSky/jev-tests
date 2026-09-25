/**
 * Whether another site's page made this request. A browser marks such a
 * request cross-site, and a page cannot send JSON to another origin without
 * asking first, so what runs a command must be JSON from this UI's own pages.
 * A client outside a browser (curl) sends neither mark and is let through.
 */
export function foreign(req: Request): boolean {
  if (!req.headers.get("content-type")?.startsWith("application/json")) return true;
  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return true;
  const origin = req.headers.get("origin");
  return origin !== null && origin !== new URL(req.url).origin;
}
