import { expect, test } from "bun:test";
import { outermost } from "./ghost";

type Box = { name: string; kids: Box[]; contains(other: Box): boolean };
const box = (name: string, ...kids: Box[]): Box => ({ name, kids, contains: (o) => kids.some((k) => k === o || k.contains(o)) });
const names = (all: Box[]) => outermost(all).map((b) => b.name);

test("keeps of what was taken out together only what no other of them holds, however deep", () => {
  const list = box("list");
  const dialog = box("dialog", list);
  const row = box("row");
  const rows = box("rows", row);
  const pane = box("pane", rows);
  expect([names([box("a"), box("b")]), names([list, dialog]), names([row, pane, rows]), names([])]).toEqual([["a", "b"], ["dialog"], ["pane"], []]);
});
