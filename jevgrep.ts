#!/usr/bin/env bun
import { DEFAULT_MODEL, makeClient, rankTitles } from "./shared";
import { render } from "./format";

type Opts = {
  question: string;
  top: number;
  threshold: number;
  batch: number;
  model: string;
  json: boolean;
  namesOnly: boolean;
};

function parseArgs(argv: string[]): Opts {
  const o: Opts = {
    question: "",
    top: Infinity,
    threshold: 1.5,
    batch: 40,
    model: DEFAULT_MODEL,
    json: false,
    namesOnly: false,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i] ?? "";
    if (a === "-n" || a === "--top") o.top = Number(next());
    else if (a === "-t" || a === "--threshold") o.threshold = Number(next());
    else if (a === "--batch") o.batch = Number(next());
    else if (a === "--model") o.model = next();
    else if (a === "--json") o.json = true;
    else if (a === "-l" || a === "--names-only") o.namesOnly = true;
    else if (a === "-h" || a === "--help") usage(0);
    else rest.push(a);
  }
  o.question = rest.join(" ").trim();
  if (!o.question) usage(1);
  return o;
}

function usage(code: number): never {
  const out = code === 0 ? console.log : console.error;
  out(`jevgrep — rank filenames by how likely they answer a question

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

const opts = parseArgs(Bun.argv.slice(2));

const names = (await Bun.stdin.text())
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

if (names.length === 0) {
  console.error("jevgrep: no filenames on stdin");
  process.exit(2);
}

const client = await makeClient(opts.model);

const rows = (await rankTitles(client, opts.question, names, opts.batch, "file named"))
  .filter((r) => r.score >= opts.threshold)
  .slice(0, opts.top);

if (opts.json) console.log(JSON.stringify(rows, null, 2));
else if (opts.namesOnly) for (const r of rows) console.log(r.name);
else if (rows.length) for (const line of render(rows)) console.log(line);

process.exit(rows.length ? 0 : 1);
