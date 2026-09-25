#!/usr/bin/env bun
import { num, parseFlags } from "./cli";
import { render } from "./format";
import { DEFAULT_MODEL, makeClient, rankTitles, snapshot, split } from "./shared";

function usage(code: number): never {
  (code === 0 ? console.log : console.error)(`jevgrep — rank filenames by how likely they answer a question

  ls | jevgrep "What are the skills in the fallout rpg?"

  -n, --top N          keep only the N best matches
  -t, --threshold F    minimum score, 0-3 (default 1.5)
  -l, --names-only     print filenames only, pipe-clean
      --json           print full answers as JSON
      --batch N        filenames per API call (default 40)
      --model SLUG     default ~typesafe/jev-latest, or $JEVGREP_MODEL

Reads filenames on stdin. Never reads file contents.
Needs $OPENROUTER_API_KEY.`);
  process.exit(code);
}

const opts = { top: Infinity, threshold: 1.5, batch: 40, model: DEFAULT_MODEL, json: false, namesOnly: false };
const words = parseFlags(
  Bun.argv.slice(2),
  opts,
  {
    "-n|--top": num("top"),
    "-t|--threshold": num("threshold"),
    "--batch": num("batch"),
    "--model": (o, next) => (o.model = next()),
    "--json": (o) => (o.json = true),
    "-l|--names-only": (o) => (o.namesOnly = true),
  },
  usage,
);
const question = words.join(" ").trim();
if (!question) usage(1);

const names = (await Bun.stdin.text())
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);
if (names.length === 0) {
  console.error("jevgrep: no filenames on stdin");
  process.exit(2);
}

const client = await makeClient(opts.model);
const snap = snapshot();
const ranked = await rankTitles(client, question, names, opts.batch, "file named");
console.error(`ranked ${names.length} names in ${split(snap)}`);
const rows = ranked.filter((r) => r.score >= opts.threshold).slice(0, opts.top);

if (opts.json) console.log(JSON.stringify(rows, null, 2));
else if (opts.namesOnly) for (const r of rows) console.log(r.name);
else for (const line of render(rows)) console.log(line);

process.exit(rows.length ? 0 : 1);
