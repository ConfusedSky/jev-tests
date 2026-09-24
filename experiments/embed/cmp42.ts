// Side by side: the 42 questions' hits and tokens from two run42.ts logs.
const parse = async (f: string) => {
  const lines = (await Bun.file(f).text()).split("\n");
  const out: { q: string; hit: string; tokens: number }[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const hit = lines[i + 1]!.trim();
    const page = /#page=(\d+)/.exec(hit)?.[1];
    const sec = hit.replace(/.*#page=\d+\s*/, "").replace(/\s*\(found.*/, "");
    const ans = hit.split("file://")[0]!.trim();
    out.push({ q: lines[i]!, hit: page ? `p.${page} ${ans.slice(0, 18)} ${sec.split(" > ").at(-1)!.slice(0, 30)}` : `— ${hit.slice(0, 40)}`, tokens: Number(/([\d,]+) tokens in/.exec(lines[i + 2]!)?.[1]!.replace(/,/g, "") ?? 0) });
  }
  return out;
};
const [a, b] = await Promise.all(process.argv.slice(2, 4).map(parse));
let ta = 0;
let tb = 0;
for (const [i, x] of a!.entries()) {
  const y = b![i]!;
  ta += x.tokens;
  tb += y.tokens;
  const same = x.hit.split(" ")[0] === y.hit.split(" ")[0];
  console.log(`${same ? " " : "*"} ${x.q.slice(0, 44).padEnd(44)} ${String(x.tokens).padStart(7)} ${String(y.tokens).padStart(7)}  ${x.hit.padEnd(52)} | ${y.hit}`);
}
console.log(`total ${ta} → ${tb} (${Math.round((100 * (tb - ta)) / ta)}%)`);
