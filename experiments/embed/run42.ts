// Runs the 42 ranking-cache questions through jevsec (ranking afresh), for more gated pages to measure.
import { Q } from "../ranking-cache/questions";
for (const [q, b] of Q) {
  const pdf = process.env[b === "F" ? "JEV_FALLOUT_PDF" : "JEV_CPR_PDF"]!;
  const p = Bun.spawn(["bun", "jevsec.ts", pdf, q, "--cache", "off"], { stdout: "pipe", stderr: "pipe", env: process.env });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  await p.exited;
  const total = /total[^\n]*/i.exec(err)?.[0] ?? err.trim().split("\n").at(-1);
  console.log(`${q}\n  ${out.trim().split("\n")[0]?.slice(0, 150)}\n  ${total}`);
}
