# Ranking cache: reusing a similar question's ranking

Idea: rankings are most of a question's tokens (~37k on Fallout even
coarse to fine). Store each book's rankings; for a new question, find a
cached question similar enough that its ranking would serve, and skip
ranking. Built as `cache.ts` and `--cache` (see [searching.md](searching.md#the-ranking-cache)); what follows is what the experiments found.

Scripts and data: [`experiments/ranking-cache/`](../experiments/ranking-cache/)
and [`experiments/ranking/simcache.ts`](../experiments/ranking/simcache.ts).
Terms (precision, recall, safety margin, AP) are defined in
[README.md](README.md).

## Recommendation

- **Match** a new question against each cached entry with Qwen3-Embedding-4B
  (Q4, run locally through Ollama on the GPU): a hit when
  **whole-question score ≥ 0.53 OR subject score ≥ 0.80**. In sample
  26/26 right, 43% recall, safety margins 0.024 and 0.020.
- **Whole-question score** = the new question with Qwen's instruction prefix
  against the cached question plus the names of its ranking's top 3
  sections ("qi~rich").
- **Subject score** = `readQuestion`'s subject against the cached subject
  ("s~s"); free, since the question is read anyway.
- **Store only rankings that led to an answer.** One bad cached ranking
  ("How much do each type of magazine cost?" ranked Screamsheets first and
  never found its answer) caused most of the wrong matches: correct
  paraphrases inheriting a broken ranking.
- **Without Ollama** the cache turns itself off and the book is ranked as
  usual. Hosted alternative: OpenAI text-embedding-3-small through
  OpenRouter (the existing key), nearly as good.

## Test set

- **First pass** (`simcache.ts`): 16 questions, 130 ordered same-book pairs.
- **Main set** (`ranking-cache/questions.ts`): 42 questions, 21 Fallout and
  21 Cyberpunk Red, with paraphrases ("How is radiation treated?" / "How do
  I cure radiation sickness?"), near misses ("damage of every small gun" /
  "every melee weapon"), members vs groups ("Is Gunslinger a perk?" / "How
  many perks are there?") and unrelated questions. 840 ordered same-book
  pairs, 61 good; 31 of 42 questions have a good cached partner. Each
  question ranked once, coarse to fine (36,620 tokens each; all 42 cost
  $0.065), saved to `rankings.json`.
- A pair is good when the new question's answer section sits in the cached
  ranking at rank ≤ max(5, its own rank) (≤5 for the magazine question,
  whose own ranking missed).

## jev pairwise (the first idea)

One noul per cached question: "The same sections of a rulebook would
answer A as answer B". ~38–50 tokens per pair.

First pass, 16 questions: at ≥0.6, 6 matched, all right; at 0.5, 9 matched,
1 wrong ("skills available" reusing "Is Lockpick a perk?", answer fell to
8th); it missed 21 pairs that would have worked. It once did better than a
fresh ranking: "What do the exotic weapons cost?" missed its own answer
section, and the cached "Show me the exotic weapons table" ranking had it
first.

Main set:

| bar | accepted | right | precision | recall |
| --- | --- | --- | --- | --- |
| 0.50 | 21 | 17 | 81% | 28% |
| 0.55 | 15 | 13 | 87% | 21% |
| 0.60 | 10 | 9 | 90% | 15% |
| 0.65 | 7 | 7 | 100% | 11% |

AP 0.608. Bar picked on Fallout at ≥90% precision, applied to CPR: 2/2, 12%
recall.

It sees only the two questions (not what their rankings found), and its
confident band is narrow: most good pairs score 0.4–0.6, with the bad ones.
Its cost grows with the cache: at ~740 cached questions per book a lookup
costs as much as ranking afresh.

## Embedding models (whole question)

Main set; "q" = question, "qi" = question with the Qwen instruction
prefix, "rich" = cached question + its top-3 section paths.

| model / variant | AP | best bar at 100% precision | at ≥90% | lookup time | size / price |
| --- | --- | --- | --- | --- | --- |
| OpenAI text-embedding-3-large, q~rich (OpenRouter) | .743 | .549: 21/21, 34% | .538: 24/25, 39% | ~520 ms | $0.13/M |
| Qwen3-Embedding-4B, qi~rich (OpenRouter) | .732 | .499: 26/26, 43% | .475: 30/33, 49% | ~250 ms | $0.02/M |
| OpenAI text-embedding-3-small, q~rich (OpenRouter) | .732 | .562: 22/22, 36% | .520: 29/32, 48% | ~325 ms | $0.02/M |
| Qwen3-Embedding-4B, qi~rich, local (HF, bf16) | .731 | .505: 25/25, 41% | .476: 30/33, 49% | 325 ms (CPU) | 4.0B params |
| **Qwen3-Embedding-4B, qi~rich, Ollama Q4 on GPU** | .723 | **.508: 26/26, 43%** | .487: 29/31, 48% | **35.5 ms** | 2.5 GB download, 4.3 GB VRAM |
| Qwen3-Embedding-8B, qi~rich (OpenRouter) | .722 | .582: 13/13, 21% | .532: 25/27, 41% | ~2 s | |
| gemini-embedding-001, q~rich (OpenRouter) | .706 | .778: 12/12, 20% | .733: 27/30, 44% | ~510 ms | $0.15/M |
| text-embedding-3-small, q~q | .691 | .695: 8/8, 13% | .557: 27/30, 44% | | |
| Qwen3-Embedding-0.6B, qi~rich, GPU | .673 | .587: 18/18, 30% | .548: 23/24, 38% | 14.9 ms (CPU 137 ms) | 1.27 GB VRAM |
| jev pairwise (above) | .608 | .630: 8/8, 13% | .570: 12/13, 20% | 153 ms per 20 pairs | ~50 tokens per pair |
| all-MiniLM-L6, q~rich, GPU | .603 | .581: 8/8, 13% | .519: 18/20, 30% | 2.4 ms | 59 MB |
| Qwen3-Embedding-0.6B, qi~q | .568 | .619: 16/16, 26% | .580: 17/18, 28% | | |
| bge-large, q~q (OpenRouter) | .529 | .845: 4/4 | .763: 11/12 | | |
| bge-small, q~q / q~rich, GPU | .517 / .473 | .820: 8/8 / .705: 15/15 | | 3.8 ms | 81 MB |
| bge-base, q~q, GPU | .469 | .873: 2/2 | .777: 9/10 | 3.8 ms | 239 MB |
| SigLIP-base / SigLIP2 text tower | .422 / .495 | .911: 8/8 / .949: 12/12 | | 2.4–2.7 ms | 458 / 787 MB |

Findings:

- **The rich cached side helps most**: 3-small .691 → .732; Qwen3-4B .547 →
  .732 and Qwen3-0.6B .523 → .673, both only with the instruction prefix
  (without it rich text made Qwen worse, 0.6B .560). bge and SigLIP gained
  nothing; the SigLIP2 rich variant was the worst of all (.243).
- **Hosted vs local Qwen3-4B is the same model**: OpenRouter 26/26 at 43%,
  local Q4 26/26 at 43%; local is ~7× faster and free.
- **Qwen3-4B at 16-bit does not fit the 8 GB RTX 4060** (out of memory at
  7.5 GB); the Q4 Ollama build (`qwen3-embedding:4b`) fits in 4.3 GB and
  loses nothing. Anything else holding GPU memory (the `semif` backend's
  model takes 7.8 GB) pushes the model to the CPU.
- **Bars carry across books**: bar picked on Fallout at ≥90% precision,
  applied to CPR: 3-large 7/7, Qwen3-0.6B 9/10, 3-small 9/11, Qwen3-4B 8/9
  (Ollama Q4) and 10/16 (16-bit on CPU), jev 2/2.
- **Cost per lookup is fixed**: one embedding of ~10–15 tokens of question
  plus N dot products (microseconds even at N = 10,000); the cached side is
  embedded once when stored. 3-small ~$3e-7 per lookup, 3-large ~$2e-6,
  local free. A hit saves ~$0.0015.
- **Remaining wrong matches are real near misses**: "damage of every melee
  weapon" ← "damage of every small gun"; "exotic weapons cost" ← "cost of a
  heavy pistol"; "ammunition cost" ↔ "drum magazine cost"; and the broken
  magazine ranking.

## Embedding the subject instead

`readQuestion`'s subject (`subjects.json`; ~2,262 tokens per question,
already paid when the app reads a question). "s" = subject, "si" = with
prefix, "srich" = cached subject + top-3 paths, "sq" = subject + quantities
or counted.

| model / variant | AP | best bar at 100% precision | at ≥90% | Fallout bar on CPR |
| --- | --- | --- | --- | --- |
| Qwen3-4B Q4, qi~rich (reference) | .723 | .508: 26/26, 43% | .487: 29/31, 48% | 9/13, 53% |
| Qwen3-4B, s~s | .557 | .794: 22/22, 36% | same | 8/8, 47% |
| Qwen3-4B, s~srich | .633 | .488: 15/15, 25% | .466: 20/22, 33% | 9/9, 53% |
| Qwen3-4B, si~srich | .641 | .581: 9/9, 15% | .502: 23/25, 38% | 1/1, 6% |
| Qwen3-4B, sq~sq | .524 | .772: 18/18, 30% | same | 8/8, 47% |
| Qwen3-4B, sqi~sqrich | .619 | .554: 16/16, 26% | .530: 22/24, 36% | 6/6, 35% |
| Qwen3-0.6B, s~s | .498 | .849: 18/18, 30% | same | 6/6, 35% |
| Qwen3-0.6B, sqi~sqrich | .606 | .582: 23/23, 38% | .561: 24/26, 39% | 9/9, 53% |
| 3-small, s~srich | .672 | .506: 19/19, 31% | .463: 24/26, 39% | 12/17, 71% |
| 3-small, s~s | .568 | .692: 18/18, 30% | same | 9/12, 53% |

- **Subject alone is clean only at a high bar, and the margin is thin**:
  Qwen3-4B s~s first wrong pair "exotic weapons" ↔ "ranged weapon" at 0.780,
  0.014 under the best bar; at 0.70 it accepts 58 pairs, 26 good.
- **It keeps apart questions about the same thing asking different
  figures** (small gun vs melee weapon damage; RadAway cost vs combat rifle),
  catches some reverse pairs (combat rifle ← small guns), and is never
  fooled by shared wording ("How much does … cost").
- **It loses members of a group**: "Gunslinger" alone says nothing about
  perks, so "Is Gunslinger a perk?" ↔ "How many perks?", power fist ← melee
  weapons and heavy pistol ← ranged weapons are missed.
- **Adding quantities hurts**: "cost" pulls unrelated cost questions
  together (the one wrong match: drum ← each type of magazine).
- **The instruction prefix** helps only against a rich cached side; it
  hurts symmetric subject~subject, and never helped 3-small.
- `readQuestion` returns some odd subjects: "character" for "How much can my
  character carry?", "death saves work", "type, magazine", "Gunslinger"
  without "perk", and "all" as a quantity. Worth fixing for the text search
  too.

## Combining the whole question and the subject

A = qi~rich, B = s~s (3-small: A = q~rich). Grids swept both bars in steps
of 0.01; `experiments/ranking-cache/combo.ts`, `ortx.ts`.

Qwen3-4B Q4:

| rule | 100% precision | ≥95% | ≥90% |
| --- | --- | --- | --- |
| A alone | .508: 26/26, 43% (margin .002) | | .487: 29/31 |
| B alone | .794: 22/22, 36% (margin .014) | | |
| A AND B | 25/25, 41% at A≥.51, B≥.50 (B does nothing) | 28/29, 46% at .49 / .59 | 29/32, 48% |
| **A OR B** | **29/29, 48% at A≥.52 OR B≥.79** (margins .014 / .010) | 31/32, 51% | 32/34, 52% |
| 0.8·A + 0.2·B | 29/29, 48% at ≥.535 (margin .005) | 30/31, 49% | |

Fixed OR rules: A≥.52 or B≥.79 29/29, 48%; **A≥.53 or B≥.80 26/26, 43%,
margins .024 / .020**; A≥.55 or B≥.80 25/25; A≥.52 or B≥.85 25/25; A≥.53 or
B≥.82 24/24.

Fallout bar on CPR: AND (A≥.49, B≥.59) 8/8, 47%; **OR (A≥.49, B≥.79) 10/11,
59%**; A alone 9/13, 53%; B alone 8/8, 47%.

Other models at 100% precision: Qwen3-0.6B A 18/18, B 18/18, AND 22/22 (36%,
the one case AND helped), OR 23/23 (38%); 3-small A 22/22, B 18/18, AND 19/19,
OR 25/25 (41%, A≥.56 or B≥.70), 0.8·A + 0.2·B 26/26 (43%, ≥.548).

- **AND fails** because the wrong pairs that score high on A also score
  middling on B, like good pairs do: "skills available" ← "Is Lockpick a
  perk?" (.506, .612) vs "How many perks?" ← "Is Gunslinger a perk?" (.504,
  .602).
- **OR works** because a subject score ≥ 0.80 was never wrong in the sample
  (highest wrong 0.78), and it catches good pairs the whole question scores
  low: combat rifle and hunting rifle ← every small gun, "List all the
  skills" ← "How many skills are there in the game?", failing a death save ←
  how death saves work, treating a critical injury ← critical injuries to
  the head. It also turns "skills available" ← "Is Lockpick a perk?" from a
  wrong hit into a miss.
- **Still missed by every rule**: a member vs its group (Gunslinger/Lockpick ↔
  perks, power fist ← melee weapons, heavy pistol ← ranged weapons).

## As built

End to end on Fallout: "How is radiation treated?" ranked afresh (54,681
tokens) and was stored; "How do I cure radiation sickness?" walked its
ranking (question 0.53, subject 0.85) for 14,022 tokens and answered from
RadAway p.171. Qwen3-4B Q4 with only ~2.8 GB of an 8 GB GPU free loaded
60% on the CPU: 171 ms median per lookup (36 ms with the GPU free);
text-embedding-3-small through OpenRouter 293 ms.

## Design notes

- Per book, on disk; entries hold the question, its rich text and subject,
  each embedded once when stored, plus the ranking.
- Store an entry only after its ranking led to an answer.
- Recheck the bars (0.53 / 0.80) as real lookups come in; add bench cases
  for a hit, a miss and a paraphrase.

## Offering to rank afresh

When a walk off a cached ranking finds nothing, the UI offers to ask again
with `--cache off`. As first built it offered that only on a "weak" match:
a whole-question score under its bar plus an unmeasured 0.1, which also
called every hit the subject carried weak. Measured here with Qwen3-4B Q4;
a hit's distance over the rule is the larger of whole − 0.53 and subject −
0.80. Scripts: `margin.ts` (labelled pairs), `trace.ts` and `afresh.ts`
(the bench with the cache on against the bench ranking afresh), `walks.ts`
(real walks of the labelled pairs, kept in `walks.json`). Cost $0.31: the
two bench runs $0.175, the walks $0.127, reruns and a fixture $0.006.

**Labelled pairs** (840, embedded again: still 26/26 at 0.53 / 0.80):

| distance over the rule | good | bad |
| --- | --- | --- |
| −0.10 to −0.05 | 11 | 39 |
| −0.05 to 0 | 6 | 10 |
| 0 to +0.03 | 5 | 0 |
| +0.03 to +0.05 | 8 | 0 |
| +0.05 to +0.10 | 5 | 0 |
| +0.10 and over | 8 | 0 |

- No accepted pair is wrong at any distance, out of sample too: bars
  refitted without each question (0.53 / 0.80 for 38 of 42) or on the
  other book (Fallout's 0.53 / 0.80 on CPR, CPR's 0.53 / 0.81 on Fallout)
  accept 26, all right. Wrong pairs stop 0.020 under the rule (subject
  0.78: exotic weapons cost ↔ damage of every ranged weapon) and 0.024
  under (whole 0.506: skills available ← "Is Lockpick a perk?").
- Every accepted pair's cached ranking holds the answer at rank 1 (22) or
  2 (4), so within `--max` 12 the walk reaches it either way.
- Hits crowd the bar, 13 of 26 within 0.05. None has a whole score of
  0.63 (the highest is 0.624), so the rule as built called all 26 weak.

**The bench, cache on and off** (`--no-save` both; the cache on run used a
copy of the shared cache under a scratch `XDG_CACHE_HOME`, holding 1 Heart
ranking, 6 Fallout, 3 Legend in the Mist and 5 CPR, some of them bench
questions word for word):

- 10 cases never look up (the contents confine them). The rest made 29
  lookups: 24 hits and 5 misses, which ranked afresh and were kept.
- Hits by distance over the rule: 2 under +0.03, 4 at +0.03–0.05, 3 at
  +0.05–0.10, 15 over that.
- Every hit answered, and scored as ranking afresh did on every case but
  two. The magazine case (+0.05) scored 100% off the cached ranking in 2
  runs of 2 and 0% ranked afresh in 2 of 2, as in the recorded run: its
  known p.344 gate. The shelf table scored 97% against 98% through its CPR
  cell, which never looks up. 1,928,514 tokens against 2,235,875.
- The weakest hits answered. "How does hero creation work in Legend in the
  Mist?" off "How do Fellowship themes work…" (+0.009, the whole question
  alone at 0.54, subject 0.50) took p.73 for 76,492 tokens against 48,196
  afresh. Heart's "What are the skills available to a character?" off "how
  many skills are there in Heart?" (+0.011, the subject alone) took p.12
  for 11,095 against 24,345.
- As built, 16 of the 24 hits were "weak", 5 of them the same question
  found again (whole 0.49–0.63, subject 1.00): the cached side holds its
  top three sections, so a question can score under 0.63 against itself.

**Walks off a partner's ranking** (`walks.ts`): the 42 labelled pairs at
−0.05 or more over the rule. Each question was walked afresh with a cache
of its own, which kept its ranking when it answered, then on each
partner's kept ranking, excerpts and all, whatever the pair scored. 41
walked; 3 that the contents confined never used the cached ranking and are
left out. The distance is the live one, which moves up to 0.05 from the
labelled one because the cached side holds the real ranking's top three.

| live distance over the rule | walked | same page as afresh | both right, other pages | cached missed, afresh answered | cached wrong, afresh right | cached right, afresh not |
| --- | --- | --- | --- | --- | --- | --- |
| under −0.05 | 2 | 1 | 1 | | | |
| −0.05 to 0 | 11 | 7 | | 1 | 3 | |
| 0 to +0.03 | 6 | 4 | 2 | | | |
| +0.03 to +0.05 | 8 | 6 | 2 | | | |
| +0.05 to +0.10 | 5 | 3 | | | | 2 |
| +0.10 and over | 6 | 4 | | | | 2 |

- Over the rule, 25 walks: none missed and none did worse than ranking
  afresh. 4 did better: walked afresh, the RadAway and Stimpak questions
  took the Chems table (p.167) or the healing rules (p.36), where the
  cached ranking reached the item's own entry.
- Under it the failures start. "What is the damage of every small gun?"
  off "…every melee weapon?" (−0.043) found nothing where afresh took p.97;
  "How do I treat a critical injury?" off "What happens when I fail a death
  save?" (−0.050) took Death Saves. The other two "wrong" (exotic weapons
  cost off ranged weapons damage and off heavy pistol cost, −0.02) took
  p.348, the Night Market's copy of the exotic price table, which the
  bench accepts.

**A short outline.** A walk that misses reads `--max` sections or the
whole ranking, whichever is fewer, unless `--max-answers` answers under the
floor stop it first. In the shared cache and these runs, rankings of the
four bench books hold 41–503 sections (Fallout and CPR keep a
page-embedding shortlist, Heart and Legend in the Mist their whole
outlines), other books' 85–189, and the fixtures' and one PDF whose outline
is a single bookmark 0–3. On `gadgets.pdf` (one section, three pages), "How
much does it cost to repair the Cinder?" walked the ranking of "How much
does the Cinder cost?" (question 0.66, subject 1.00) and missed, best 0.56
on p.1. Ranked afresh (374 tokens for the one section) it read the same
three windows and missed the same way. A walk that stopped for neither
reason read its whole ranking; ranking again only reorders those sections
and swaps the cached question's excerpt pages for this one's.

**Adopted: no margin.** Over the rule, 49 walks off a cached ranking (24
bench hits, 25 labelled pairs) ran from +0.002 to +0.26. None missed, none
did worse than ranking afresh, and the one case that differed went the
cache's way. That puts a miss off an accepted ranking under about 6% (0 of
49, fewer independent: four bench tables share one lookup), with nothing
near the bar to key on. Wrong matches start under the rule, where the bars'
0.020 / 0.024 safety margins keep them out. A margin would fire only on
sound hits: 0.1 over the rule flags 18 of 26 labelled hits and 9 of 24
bench hits, 0.03 flags 5 and 2, and the rule as built flagged 26 and 16. So
the UI offers the fresh ranking on any miss off a cached ranking whose walk
stopped with some of the ranking unread, at `--max` sections or at
`--max-answers` answers under the floor (`offerAfresh` in `ui/options.ts`),
and says what happened rather than calling the match weak. A miss that
stopped for neither read its whole ranking, as on `gadgets.pdf`.

Not measured: how often ranking afresh rescues a miss off a cached
ranking, since none of the 49 missed. `trace.ts` logs every lookup of a run
(the question, its match and both scores); pairing those with outcomes as
real lookups come in would show whether a margin is ever worth having.
