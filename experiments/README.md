# Experiments

One-off measurement scripts behind [`docs/`](../docs/README.md). They are
not part of the app, are left out of `tsc` (`tsconfig.json` excludes this
directory) and have no tests. Run them from the repo root so Bun loads
`.env` (the book paths and `OPENROUTER_API_KEY`); each spends real tokens.

| directory | what | results in |
| --- | --- | --- |
| `ranking/` | `rankexp.ts`: ranking prompt variants; `tier.ts`: full vs coarse-to-fine ranking; `simcache.ts`: the first 16-question jev similarity test | [token-usage.md](../docs/token-usage.md), [ranking-cache.md](../docs/ranking-cache.md) |
| `ranking-cache/` | the 42-question similarity study | [ranking-cache.md](../docs/ranking-cache.md) |
| `choice-ranking/` | ranking by one choice question: a patch and its comparison script | [choice-ranking.md](../docs/choice-ranking.md) |
| `embed/` | page embeddings as a ranking shortlist and as a page check | [token-usage.md](../docs/token-usage.md), [dead-ends.md](../docs/dead-ends.md) |
| `compose/` | `read-request.ts`: how a table request reads (rows, columns, `keep`); `pick-table.ts`: which of CPR p.95's two tables is taken for the rows | [tables.md](../docs/tables.md) |
| `across/` | `read.ts`: how jev reads a table request across the shelf, word by word, and each cell question's kind in two wordings; `rows.ts`: one request's row reading repeated | [tables.md](../docs/tables.md) |
| `pages/` | `origins.py`: a book's pages drawn from a corner off pdfplumber's 0,0 or turned, the only pages where `tables.py` moves a table (`.venv/bin/python`, free) | [pages.md](../docs/pages.md#the-highlight-as-data) |

## ranking-cache

Data kept here, so a rerun need not pay for it again:

- `questions.ts`: the 42 questions and each one's answer-section regex.
- `rankings.json`: each question's coarse-to-fine ranking and own rank
  (from `rank.ts`, ~$0.065 to redo).
- `subjects.json`: `readQuestion`'s subject, quantities and counted
  (`subjects.ts`).
- `jevpairs.json`: jev's pairwise similarity (`jevpair.ts`).
- `texts.json`, `texts2.json`: the texts embedded per variant
  (`texts.ts`, `texts2.ts`).

Embeddings are not kept (`embs*/` is gitignored); make them again with:

- `openrouter.ts`, `openrouter2.ts`: hosted models through OpenRouter.
- `ollama.ts`, `ollama2.ts`: Qwen3-Embedding through a local Ollama server
  (`ollama pull qwen3-embedding:4b`; start the server yourself and stop it
  by its PID afterwards).
- `local.py`, `local2.py`: sentence-transformers and SigLIP on the GPU; needs
  a venv with torch and sentence-transformers (`uv venv`; ~5.6 GB).
  Qwen3-Embedding-4B at 16-bit does not fit an 8 GB GPU.

Then score: `score.ts` (whole-question variants), `score2.ts` (subject
variants; `PROBE=` prints the near-miss table), `grid.ts`, `sgrid.ts`
(threshold grids), `combo.ts` (AND/OR/weighted, e.g.
`bun experiments/ranking-cache/combo.ts ollama_qwen3-embedding-4b 0.49,0.59`),
`ortx.ts` (fixed OR rules and the Fallout→CPR check).

When to offer ranking afresh after a miss off a cached ranking:

- `margin.ts`: good and bad pairs by distance over the adopted OR rule, in
  sample and with the bars refitted without each question or on the other
  book. Free.
- `trace.ts`: a preload that logs every ranking-cache lookup and store of a
  run to `$JEV_TRACE`, since the bench runs quiet:
  `JEV_TRACE=/tmp/on.jsonl bun --preload ./experiments/ranking-cache/trace.ts bench.ts --cache qwen3-4b --no-save`.
  `afresh.ts TRACE ON.out OFF.out` joins that run's stdout with runs
  ranking afresh, case by case.
- `walks.ts`: each labelled pair near or over the rule walked afresh and on
  the partner's kept ranking (~$0.13), kept in `walks.json`; with no
  argument it prints the outcomes by distance over the rule.

## choice-ranking

`choice-ranking.patch` applies to commit 8416595 (`git apply`); it adds
`rankChoice` to `shared.ts` and `rankPool` with a `JEV_CHOICE=1` flag to
`pdf.ts`. `compare.ts` needs the patch applied.

## embed

`lib.ts` embeds every page of the four bench books through a running
Ollama with `qwen3-embedding:4b` into `embed/cache/` (gitignored;
`build.ts`, a few minutes a book). `evalA.ts` scores pages by embedding
against the answer pages; `c2f.ts`, `c2f2.ts` compare shortlists for jev's
ranking; `run42.ts`, `cmp42.ts` run the 42 ranking-cache questions both
ways; `seed.ts` copies the vectors into the app's store
(`~/.cache/jev/embeddings/`). `evalB.ts` (the page-check bars) reads the
JSONL log that `embed-gate-and-rank.patch` writes under `JEV_GATE_LOG`;
that patch applies to commit 7373c0a and holds the experimental flags
(`JEV_EMBED_RANK`, `JEV_EMBED_GATE`).
