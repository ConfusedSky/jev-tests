# Notes from experiments

What was measured, what was adopted, and what was tried and dropped, so it
is not re-derived. The scripts behind the numbers are in
[`experiments/`](../experiments/README.md).

How the tools work is in [searching.md](searching.md), [answers.md](answers.md),
[tables.md](tables.md), [pages.md](pages.md) and [semif.md](semif.md). The
rest of this directory records experiments:

| document | covers |
| --- | --- |
| [token-usage.md](token-usage.md) | where a question's tokens go; page embeddings picking the sections jev ranks (adopted), coarse-to-fine ranking (adopted before it, now the fallback); shorter ranking prompts, reusing a ranking across a table's columns (dropped); reading a table's cells before searching (measured, not built) |
| [ranking-cache.md](ranking-cache.md) | reusing a cached ranking for a similar question: jev pairwise vs embedding models, local and via OpenRouter; whole question vs subject; combining the two |
| [choice-ranking.md](choice-ranking.md) | ranking an outline with one `choice` question instead of a `score` question per section (dropped) |
| [dead-ends.md](dead-ends.md) | approaches tried while building features (question kinds, tables to order, lookups, the log) that did not work, and what replaced them |

## Terms used throughout

Measuring a matcher (for the ranking cache): every pair of questions from
the same book is a candidate "reuse the cached question's ranking for the
new one". A pair is **good** when the cached ranking would have served:
the new question's answering section sits in it at rank ≤ max(5, the rank
its own ranking gave it).

- **accepted**: pairs the rule says to reuse. Written right/accepted, e.g.
  26/26.
- **precision** = right ÷ accepted: how often a cache hit is safe. A wrong
  hit sends the walk to the wrong sections, so this matters most.
- **recall** = right ÷ all good pairs: how many of the chances to save a
  ranking the rule takes. A miss costs tokens, not correctness.
- **safety margin**: how far a bar sits above the highest-scoring wrong
  pair. A thin margin (0.002) means a small drift in scores on new
  questions lets a wrong match through.
- **AP** (average precision): one number for how well a score separates
  good pairs from bad across every bar; higher is better.

Prices: jev costs $0.042 per million input tokens; its output tokens are
free.

All numbers come from small samples (16–42 questions) with bars tuned on
the same questions; read each count as ±1–2.
