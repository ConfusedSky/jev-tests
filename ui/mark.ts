/**
 * Where on a rendered page the answer is highlighted. highlight.js marks it
 * in yellow (1, 0.9, 0.2), which a page's own ink and paper seldom are, so
 * the mark is found by its colour in the page's pixels.
 */
const marked = (r: number, g: number, b: number) => r > 235 && g > 205 && g < 250 && b < 120;

/**
 * The rows the highlight spans in RGBA pixels `width` wide, or undefined
 * when nothing on the page is marked. A row counts once a run of it is the
 * highlight's yellow, as a marked line is; a speck of yellow artwork is not.
 */
export function markRows(data: Uint8ClampedArray, width: number, step = 2, run = 12): [number, number] | undefined {
  const height = Math.floor(data.length / 4 / width);
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += step) {
    let n = 0;
    for (let x = 0; x < width && n < run; x += step) {
      const i = (y * width + x) * 4;
      n = marked(data[i]!, data[i + 1]!, data[i + 2]!) ? n + 1 : 0;
    }
    if (n < run) continue;
    if (top < 0) top = y;
    bottom = y;
  }
  return top < 0 ? undefined : [top, bottom];
}
