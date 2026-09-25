import { describe, expect, test } from "bun:test";
import { foreign, local, namesFrom } from "./guard";

const PORT = 3217;
const post = (headers: Record<string, string>, host = `127.0.0.1:${PORT}`) =>
  new Request(`http://${host}/api/run`, { method: "POST", headers: { host, ...headers }, body: "{}" });
const JSON_ = { "content-type": "application/json" };

describe("local", () => {
  test("takes the server's own names on its own port", () => {
    for (const host of [`127.0.0.1:${PORT}`, `localhost:${PORT}`, `LOCALHOST:${PORT}`, `[::1]:${PORT}`]) expect(local(post({}, host), PORT)).toBe(true);
  });

  // A site that points its own name at 127.0.0.1 reaches the server with that name as the Host.
  test("refuses any other name or port", () => {
    expect(local(post({}, `evil.example:${PORT}`), PORT)).toBe(false);
    expect(local(post({}, "127.0.0.1:9999"), PORT)).toBe(false);
  });
});

describe("foreign", () => {
  test("lets in JSON from the UI's own page, and from a client outside a browser", () => {
    expect(foreign(post({ ...JSON_, "sec-fetch-site": "same-origin", origin: `http://127.0.0.1:${PORT}` }), PORT)).toBe(false);
    expect(foreign(post({ ...JSON_, origin: `http://localhost:${PORT}` }, `localhost:${PORT}`), PORT)).toBe(false);
    expect(foreign(post(JSON_), PORT)).toBe(false);
  });

  // A form or a no-cors fetch from another site can post text/plain without asking the server first.
  test("refuses what another site's page could send", () => {
    expect(foreign(post({ "content-type": "text/plain" }), PORT)).toBe(true);
    expect(foreign(post({}), PORT)).toBe(true);
    expect(foreign(post({ ...JSON_, "sec-fetch-site": "cross-site" }), PORT)).toBe(true);
    expect(foreign(post({ ...JSON_, "sec-fetch-site": "same-site", origin: "http://127.0.0.1:3000" }), PORT)).toBe(true);
    expect(foreign(post({ ...JSON_, origin: "http://evil.example" }), PORT)).toBe(true);
  });

  test("refuses a rebound name even when its origin matches it", () => {
    expect(foreign(post({ ...JSON_, "sec-fetch-site": "same-origin", origin: `http://evil.example:${PORT}` }, `evil.example:${PORT}`), PORT)).toBe(true);
  });
});

describe("extra names", () => {
  const TAILNET = "box.tailnet.ts.net:3217";
  const extra = namesFrom(` ${TAILNET.toUpperCase()} , `);

  test("are read from a comma-separated list, trimmed and lower-cased", () => {
    expect(extra).toEqual([TAILNET]);
    expect(namesFrom(undefined)).toEqual([]);
  });

  test("are answered to only when given", () => {
    expect(local(post({}, TAILNET), PORT)).toBe(false);
    expect(local(post({}, TAILNET), PORT, extra)).toBe(true);
  });

  // A proxy such as tailscale serve ends TLS in front of the server, so the page's origin is https.
  test("let in JSON from their own page over https, not from another site", () => {
    expect(foreign(post({ ...JSON_, "sec-fetch-site": "same-origin", origin: `https://${TAILNET}` }, TAILNET), PORT, extra)).toBe(false);
    expect(foreign(post({ ...JSON_, origin: "https://evil.example" }, TAILNET), PORT, extra)).toBe(true);
    expect(foreign(post({ ...JSON_, origin: `https://${TAILNET}` }, "evil.example:3217"), PORT, extra)).toBe(true);
  });
});
