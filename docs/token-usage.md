# Token usage

Measured September 2026 on the four bench books: Heart (95 outline
sections), Legend in the Mist (169), Cyberpunk Red (554), Fallout (1058).
jev costs $0.042 per million input tokens; output is free. Every log step
prints its tokens and cost, and the bench prints each case's input tokens
and the run's total.

## Where the tokens go

Ranking an outline asks jev one `score` question per section and excerpt
(`rank()` in `shared.ts`, 40 per call), about 120–124 input tokens each:
each question carries the section's label and the 4-level rubric, and the
label is repeated in the state. Before coarse-to-fine:

| run | input tokens | ranking's share |
| --- | --- | --- |
| Fallout passage ("How is radiation treated?") | 144,769 | 131,281 (91%) |
| Fallout table with mod costs | 196,923 | 131,416 (67%) |
| CPR table searching 2 columns | ~330,000 | 3 rankings × ~68,000 |
| jevfind ranking the shelf (352 paths, 312 excerpts) | +79,791 | |

Reading a section costs ~1,300–13,000 tokens; reading the question 1,600–9,500
(it grows with its words: four nouls per word); a table request reads its
words again for rows and columns (~7,600–9,300).

## Adopted: coarse-to-fine ranking (commit 8416595)

An outline of more than 200 sections (`TIER_MIN`) that the contents do not
confine is ranked by its top two levels and the excerpts first, then only
the sections under the best 8 (`TIER_K`) of those levels (`rankTiered`,
`coarse`, `sectionsUnder` in `pdf.ts`).

Side by side on 8 questions (`experiments/ranking/tier.ts`):

| question | full ranking | coarse-to-fine | top-12 kept | answer section in top 3 (full / tiered) |
| --- | --- | --- | --- | --- |
| How is radiation treated? | 128,459 | 38,945 (−70%) | 6/12 | yes / yes |
| How many perks are there? | 128,486 | 38,391 (−70%) | 5/12 | yes / yes |
| cost, weight, damage of a combat rifle | 128,702 | 56,464 (−56%) | 7/12 | no / yes |
| Is Gunslinger a perk? | 128,486 | 35,958 (−72%) | 6/12 | yes / yes |
| the table of all the small guns | 128,567 | 59,980 (−53%) | 9/12 | yes / yes |
| CPR exotic weapons table | 64,807 | 26,793 (−59%) | 8/12 | yes / yes |
| CPR magazine cost | 64,919 | 28,937 (−55%) | 7/12 | no / no |
| CPR standard ranged weapons table | 64,863 | 28,655 (−56%) | 5/12 | yes / yes |

Full ranking against itself between runs keeps 9–12 of its top 12.

Full bench: **3.94M → 2.42M input tokens (−39%, $0.165 → $0.102)**, same
scores. Fallout cases saved 45–67%, CPR 18–43%; Heart and Legend in the
Mist are under 200 sections and unchanged. Two cases dropped in one run and
were rerun: CPR's skill count is confined by the contents so never ranks
coarse to fine (identical tokens, it varies 76–92% either way), and the
magazine question's page gates either side of 0.7 (marked `known`).

## Dropped: shorter ranking prompts

Rank of all 1058 Fallout sections for three questions
(`experiments/ranking/rankexp.ts`), against the prompt as it is:

| change | tokens saved | today's top 12 kept |
| --- | --- | --- |
| one-word rubric levels | 15% | 5–10 |
| label in the question text only (not in the state) | 22% | 5–8 |
| label in the state only | 14% | 2–9 (RadAway lost to Psycho) |
| both | 29% | 2–10 |
| batch 120 instead of 40 | 4% | 7–10 |

Today's ranking keeps 9–12 of its own top 12 between runs, so every
variant reorders more than noise. Not worth it after coarse-to-fine.

## Dropped: reusing one ranking across a table's column searches

A table's column searches each ranked the outline again. Walking the rows
search's ranking instead (tried behind `JEV_REUSE=1`, reverted), CPR,
after coarse-to-fine:

| table | today | reuse |
| --- | --- | --- |
| drum magazine size | 283–291k | 287–302k (no saving) |
| all 7 columns | 391–392k | 306–353k (10–22%) |

Cells came out the same. After coarse-to-fine a CPR ranking costs ~31k, so
there is little to reuse; the column searches' walks are what cost.

The earlier "131k per column ranking" in the logs was the parallel column
searches counting each other's calls on the shared counter; they now run
one at a time.

## Measured, not built: read a table's cells before searching its columns

On the CPR drum table 213k of 282k tokens went to the column searches; the
ammo type search alone spent 112k and found no table, and ammo type then
came from the rows' own cells ("M Pistol" out of "12 (M Pistol)") for 11
of 11 rows. Asking the rows' cells first and searching only columns they
leave mostly empty (tried behind `JEV_CELLS_FIRST=1`, reverted):

| table (CPR) | today | cells first |
| --- | --- | --- |
| drum magazine size | 283–291k | **158k (−45%)** |
| all 7 columns | 391–392k | **261–276k (−30%)** |

Cells were the same in every run; drum and extended sizes still came from
the p.345 clip chart (jev reads no such value from the cells). Largest
saving left for tables; about 20 lines in `compose.ts`, needs a full bench.

## Other ideas

- **Ranking cache** keyed by question similarity: see
  [ranking-cache.md](ranking-cache.md). A hit saves a whole ranking
  (~37k tokens on Fallout).
- **One choice per ranking** instead of a score question per section: see
  [choice-ranking.md](choice-ranking.md). Dropped.
- **Cheaper question reading**: 2–5% of a run. Not worth it.
