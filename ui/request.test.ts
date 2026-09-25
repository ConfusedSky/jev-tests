import { describe, expect, test } from "bun:test";
import { DEFAULTS } from "./options";
import { checkMarks, checkRequest } from "./request";
import type { RunRequest } from "./types";

const shelf: RunRequest = { tool: "jevfind", question: "q", options: DEFAULTS, paths: ["/a.pdf", "/b c.pdf"] };
const error = (body: unknown) => {
  const r = checkRequest(body);
  return "error" in r ? r.error : undefined;
};

describe("checkRequest", () => {
  test("passes what the UI sends, as it sent it", () => {
    expect(checkRequest(shelf)).toEqual({ request: shelf });
    expect(checkRequest({ tool: "jevsec", question: "q", options: DEFAULTS, pdf: "/a.pdf", paths: ["/x.pdf"] })).toEqual({ request: { tool: "jevsec", question: "q", options: DEFAULTS, pdf: "/a.pdf" } });
  });

  test("refuses paths that are not each a path on a line of its own", () => {
    expect(error({ ...shelf, paths: [123, null] })).toBe("every path must be a file's path, as text on one line");
    expect(error({ ...shelf, paths: ["/a.pdf", ""] })).toBeDefined();
    expect(error({ ...shelf, paths: ["/a.pdf\n/etc/passwd"] })).toBeDefined();
    expect(error({ ...shelf, paths: "/a.pdf" })).toBe("the shelf is empty");
    expect(error({ ...shelf, paths: [] })).toBe("the shelf is empty");
  });

  test("refuses an option not of its spec's type, or a number out of its range", () => {
    expect(error({ ...shelf, options: { ...DEFAULTS, batch: "zz" } })).toBe("the option batch must be a number");
    expect(error({ ...shelf, options: { ...DEFAULTS, batch: 9999 } })).toBe("Names per call must be between 1 and 500");
    expect(error({ ...shelf, options: { ...DEFAULTS, search: "no" } })).toBe("the option search must be true or false");
    expect(error({ ...shelf, options: { ...DEFAULTS, cache: "../x" } })).toBe("the option cache must be one of qwen3-4b, qwen3-0.6b, 3-small, off");
    expect(error({ ...shelf, options: { ...DEFAULTS, model: 5 } })).toBe("the option model must be text");
    expect(error({ ...shelf, options: [] })).toBe("options must be a JSON object");
  });

  test("drops options it does not know and fills those left out", () => {
    expect(checkRequest({ ...shelf, options: { hits: 3, retired: true } })).toEqual({ request: { ...shelf, options: { ...DEFAULTS, hits: 3 } } });
  });

  // -n 1.5 ran as a count of passages no one asked for.
  test("refuses a fraction where the option counts something", () => {
    expect(error({ ...shelf, options: { ...DEFAULTS, hits: 1.5 } })).toBe("Passages must be a whole number");
    expect(error({ ...shelf, options: { ...DEFAULTS, max: 12.25 } })).toBe("Max sections must be a whole number");
    expect(error({ ...shelf, options: { ...DEFAULTS, threshold: 0.65 } })).toBeUndefined();
  });

  // "--help" reached jevfind as its flag and came back as usage text.
  test("refuses a question the tool would read as an option", () => {
    expect(error({ ...shelf, question: "--help" })).toBe("A question cannot start with “-”: the tool would take it for an option");
    expect(error({ ...shelf, question: "  -n 5 skills" })).toBeDefined();
    expect(error({ ...shelf, question: "What does -n do?" })).toBeUndefined();
  });

  test("checks a number's range only where the tool takes it", () => {
    expect(error({ ...shelf, tool: "jevgrep", options: { ...DEFAULTS, threshold: 5 } })).toBeUndefined();
    expect(error({ ...shelf, options: { ...DEFAULTS, threshold: 5 } })).toBe("Page threshold must be between 0 and 1");
  });

  test("refuses a request without a tool, a question or a PDF to ask", () => {
    expect(error(null)).toBe("the request must be a JSON object");
    expect(error([shelf])).toBe("the request must be a JSON object");
    expect(error({ ...shelf, tool: "rm" })).toBe("unknown tool");
    expect(error({ ...shelf, question: "  " })).toBe("ask a question");
    expect(error({ ...shelf, question: 1 })).toBe("ask a question");
    expect(error({ tool: "jevsec", question: "q", options: DEFAULTS, pdf: 7 })).toBe("choose a PDF from the shelf");
  });
});

describe("checkMarks", () => {
  const box = { page: 3, x0: 72, y0: 100.5, x1: 540, y1: 112 };

  test("passes boxes on whole pages, keeping only their page and edges", () => {
    expect(checkMarks([{ ...box, start: 0, extra: "x" }])).toEqual({ marks: [box] });
    expect(checkMarks(undefined)).toEqual({ marks: [] });
  });

  test("refuses anything that is not a box on a page", () => {
    for (const bad of ["x", [null], [{ ...box, page: 0 }], [{ ...box, page: 1.5 }], [{ ...box, x1: "540" }], [{ ...box, y0: Infinity }], Array(5001).fill(box)])
      expect(checkMarks(bad)).toHaveProperty("error");
  });
});
