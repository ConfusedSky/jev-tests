# Ranking by one choice question (dropped)

Idea: instead of one `score` question per section or excerpt, make each an
option of a single `choice` ("Which of these sections or page excerpts
answers `question`?") and rank by the probabilities.

Code: [`experiments/choice-ranking/choice-ranking.patch`](../experiments/choice-ranking/choice-ranking.patch)
(against commit 8416595; adds `rankChoice` to `shared.ts` and `rankPool`
with a `JEV_CHOICE=1` flag to `pdf.ts`) and
[`compare.ts`](../experiments/choice-ranking/compare.ts), which ranks 19
bench questions four ways (score or choice, flat or coarse-to-fine).

## How it was built

- A choice takes at most 255 options: lists over 254 run in heats of 254,
  and each heat's picks go into a final choice.
- jev rounds probabilities to 0.01, so most options come back exactly 0
  (in one Heart probe 87 of 96, with 7 distinct values): the tail has no
  order, and the walk reads the top 12. Fix tried: elimination rounds (ask
  again without the picks) until 12 are ranked, at most 4 rounds; items
  never picked go last in outline order.
- Scores for the title floor: a pick scores 3 down to 1 by its place, an
  item never picked 0.
- Under coarse-to-fine, the first round's picks are asked again beside the
  sections under the best 8, since probabilities from separate choices
  cannot be compared.

## Results

Ranking alone, 19 bench questions:

| book | score (today) | choice |
| --- | --- | --- |
| Heart, 95 sections | 10.5k–13.4k each | 3.0k–5.8k |
| Legend in the Mist, 169 | 25k–28k | 11.3k–12.5k |
| Fallout, 1058, coarse-to-fine | 37.6k–62.3k | 7.2k–23.4k |
| Fallout, flat | 128k–131k | 23k–24k |
| CPR, 554, coarse-to-fine | 27.7k–30.8k | 8.7k–10.0k |
| **total** | **585k** | **195k (−67%)** |

A choice costs ~16 tokens per option against ~110–124 per score question.

Full bench, `--no-save`:

| ranking | mean score | input tokens |
| --- | --- | --- |
| score | 95%, 95% | 2.36M, 2.38M |
| choice | 91%, 91% | 1.85M, 1.93M (about −20%) |

The whole-run saving is small because after coarse-to-fine the ranking is
a small share of a question.

- **Regressions**: "Is heretic a calling?" wrong in 2 of 5 runs (score: 0
  of 5): the choice put the p.16 excerpt naming "heretic" above every
  section, it answered true at 0.64–0.75, under the floor, and became the
  best kept answer. The combat rifle figures found nothing in 1 of 8 runs.
- **Top of the ranking** is often better: the answer page came first in 5
  cases, worse in 2 (Heart classes #3 → #9, CPR skills #1 → #2).
- **Below the top it is much worse**: only 3–9 of the score ranking's top
  12 match; later rounds let in noise (Legend in the Mist's Oracle
  sections, Buffout and Super Stimpak for a hunting rifle question). The
  narrowest answering section often falls far down (Fallout perks #5 →
  #93).
- **Not repeatable**: score ranking spent exactly the same tokens every run;
  choice rounds vary.

## Untested follow-up

One choice round to pick the top few, then score questions only around
those picks: the choice's strength (the very top) chooses what to score,
and the rubric scores keep the order the walk relies on.
