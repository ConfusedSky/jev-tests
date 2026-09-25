import { describe, expect, test } from "bun:test";
import { foreign } from "./guard";

const post = (headers: Record<string, string>) => new Request("http://127.0.0.1:3217/api/run", { method: "POST", headers, body: "{}" });
const JSON_ = { "content-type": "application/json" };

describe("foreign", () => {
  test("lets in JSON from the UI's own page, and from a client outside a browser", () => {
    expect(foreign(post({ ...JSON_, "sec-fetch-site": "same-origin", origin: "http://127.0.0.1:3217" }))).toBe(false);
    expect(foreign(post(JSON_))).toBe(false);
  });

  // A form or a no-cors fetch from another site can post text/plain without asking the server first.
  test("refuses what another site's page could send", () => {
    expect(foreign(post({ "content-type": "text/plain" }))).toBe(true);
    expect(foreign(post({}))).toBe(true);
    expect(foreign(post({ ...JSON_, "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(foreign(post({ ...JSON_, "sec-fetch-site": "same-site", origin: "http://127.0.0.1:3000" }))).toBe(true);
    expect(foreign(post({ ...JSON_, origin: "http://evil.example" }))).toBe(true);
  });
});
