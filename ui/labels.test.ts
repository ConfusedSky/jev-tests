import { describe, expect, test } from "bun:test";
import { DOLLARS_PER_MILLION_IN } from "../shared";
import { AFRESH, charge, dayOf, inFlight, ledgerOf, PER_MILLION, spentOver } from "./labels";
import { parseLine } from "./log";
import { leftRun, outcomeOf, type Run } from "./run";

const base: Run = { id: "r", request: { tool: "jevsec", question: "q", options: {} as Run["request"]["options"], pdf: "/a.pdf" }, command: "", at: 1000, lines: [], status: "running" };
const logged = [parseLine("question looks like a count question  in 0.4s (jev 0.4s; 2,000 tokens in, 10 out, $0.00008)")];

describe("charge", () => {
  test("adds a run's spend and counts it, under its day and mode", () => {
    expect(charge({ dollars: 0.001, in: 100, runs: 1 }, { ...base, status: "done", lines: logged })).toEqual({ dollars: 0.001 + 0.00008, in: 2100, runs: 2, days: { [dayOf(base.at)]: { jevsec: 0.00008 } } });
  });

  test("sums a span of days by mode, leaving out days before it", () => {
    const now = new Date(2026, 8, 25, 12).getTime();
    const day = 86_400_000;
    const run = (at: number, tool: Run["request"]["tool"]): Run => ({ ...base, at, status: "done", request: { ...base.request, tool }, lines: logged });
    const l = [run(now, "jevsec"), run(now - day, "jevfind"), run(now - 10 * day, "jevfind")].reduce(charge, { dollars: 0, in: 0, runs: 0 });
    expect(spentOver(l, 1, now).tools).toEqual({ jevfind: 0, jevsec: 0.00008, jevgrep: 0 });
    expect(spentOver(l, 7, now).dollars).toBeCloseTo(0.00016, 10);
    expect(spentOver(l, 30, now).tools.jevfind).toBeCloseTo(0.00016, 10);
    expect(spentOver({ dollars: 1, in: 1, runs: 1 }, 7, now).dollars).toBe(0);
  });

  test("leaves out a run the server never started", () => {
    const zero = { dollars: 0, in: 0, runs: 0 };
    expect(charge(zero, { ...base, status: "done", unsent: "offline" })).toEqual(zero);
    expect(ledgerOf([{ ...base, status: "done", unsent: "refused" }, { ...base, status: "done", lines: logged }]).runs).toBe(1);
  });
});

describe("leftRun", () => {
  test("keeps a run the page left as stopped, with what it logged counted", () => {
    const left = leftRun({ ...base, lines: logged, trying: "reading…" }, 4000);
    expect(outcomeOf(left)).toBe("stopped");
    expect(left).toMatchObject({ left: true, trying: undefined, end: { code: null, ms: 3000, error: "stopped" } });
    expect(charge({ dollars: 0, in: 0, runs: 0 }, left)).toMatchObject({ in: 2000, runs: 1 });
  });
});

describe("inFlight", () => {
  const line = (text: string) => parseLine(text);

  test("sizes the call a stop cut off as the calls the log reported, on average", () => {
    const lines = [line("question looks like a count question  in 0.4s (jev 0.4s; 2,000 tokens in, 10 out, $0.00008)"), line("ranked 3 sections and 0 excerpts in 0.2s (jev 0.2s; 1,000 tokens in, 5 out, $0.00004)")];
    const est = inFlight({ ...base, status: "stopped", lines })!;
    expect(est.in).toBe(1500);
    expect(est.dollars).toBeCloseTo(0.00006, 10);
    expect(inFlight({ ...base, status: "stopped" })).toEqual({});
  });

  test("is none for a run that finished, printed its total, or never reached the server", () => {
    expect(inFlight({ ...base, status: "done", lines: logged })).toBeUndefined();
    expect(inFlight({ ...base, status: "stopped", lines: [...logged, line("total 0.4s (jev 0.4s; 2,000 tokens in, 10 out, $0.00008)")] })).toBeUndefined();
    expect(inFlight({ ...base, status: "stopped", unsent: "offline" })).toBeUndefined();
  });
});

describe("the figures the UI quotes", () => {
  test("are the CLI's", async () => {
    expect(PER_MILLION).toBe(DOLLARS_PER_MILLION_IN);
    expect(await Bun.file(new URL("../cache.ts", import.meta.url)).text()).toContain(`about ${AFRESH.toLocaleString("en-US")} tokens a book`);
  });
});
