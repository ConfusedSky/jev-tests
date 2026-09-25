import { describe, expect, test } from "bun:test";
import { whyBlocked } from "./components/Ask";
import { DEFAULTS } from "./options";

const files = [
  { path: "/shelf/book.pdf", name: "book.pdf", size: 4096 },
  { path: "/shelf/empty.pdf", name: "empty.pdf", size: 0 },
];
const asking = { tool: "jevsec" as const, question: "How do I start?", options: DEFAULTS, files };

describe("whyBlocked", () => {
  test("stops an empty PDF before anything is spent on it, question or not", () => {
    expect(whyBlocked({ ...asking, pdf: "/shelf/empty.pdf" })).toBe("This file is empty");
    expect(whyBlocked({ ...asking, pdf: "/shelf/empty.pdf", question: "" })).toBe("This file is empty");
    expect(whyBlocked({ ...asking, pdf: "/shelf/book.pdf" })).toBeUndefined();
  });

  test("lets the whole shelf be asked with an empty PDF on it, but not when every one is", () => {
    expect(whyBlocked({ ...asking, tool: "jevfind", pdf: "/shelf/empty.pdf" })).toBeUndefined();
    expect(whyBlocked({ ...asking, tool: "jevfind", files: [files[1]!] })).toBe("Every PDF on the shelf is empty");
  });

  test("says before sending that a question cannot start as an option does", () => {
    expect(whyBlocked({ ...asking, tool: "jevfind", question: "--help" })).toBe("A question cannot start with “-”: the tool would take it for an option");
  });
});
