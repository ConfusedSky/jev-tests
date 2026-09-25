import { describe, expect, test } from "bun:test";
import { markRows } from "./mark";

/** A white page `w` by `h` with rows `from` to `to` painted `rgb`. */
function page(w: number, h: number, from: number, to: number, rgb: [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = from; y <= to; y++) for (let x = 2; x < w - 2; x++) data.set([...rgb, 255], (y * w + x) * 4);
  return data;
}

describe("markRows", () => {
  test("finds the rows a yellow highlight spans", () => {
    expect(markRows(page(20, 40, 10, 15, [255, 230, 51]), 20, 1)).toEqual([10, 15]);
  });

  test("finds nothing on a page of black ink, grey rules, blue links, amber art or tinted paper", () => {
    for (const rgb of [
      [0, 0, 0],
      [200, 200, 200],
      [30, 90, 220],
      [255, 165, 0],
      [250, 240, 220],
    ] as [number, number, number][])
      expect(markRows(page(20, 40, 10, 15, rgb), 20, 1)).toBeUndefined();
  });

  test("passes over a speck of yellow narrower than a marked line", () => {
    const data = page(40, 20, 5, 5, [255, 255, 255]);
    for (let x = 0; x < 6; x++) data.set([255, 230, 51, 255], (5 * 40 + x) * 4);
    expect(markRows(data, 40, 1)).toBeUndefined();
  });
});
