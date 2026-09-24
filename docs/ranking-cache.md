# Ranking cache: reusing a similar question's ranking

Idea: rankings are most of a question's tokens (~37k on Fallout even
coarse to fine). Store each book's rankings; for a new question, find a
cached question similar enough that its ranking would serve, and skip
ranking. Built as `cache.ts` and `--cache` (see the README's "The ranking
cache"); what follows is what the experiments found.

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
  loses nothing. A long-running `semif` server once held 7.8 GB of the GPU
  and pushed runs to the CPU.
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
RadAway p.171. Qwen3-4B Q4 beside another project on the 8 GB GPU loaded
60% on the CPU: 171 ms median per lookup (36 ms with the GPU free);
text-embedding-3-small through OpenRouter 293 ms.

## Design notes

- Per book, on disk; entries hold the question, its rich text and subject,
  each embedded once when stored, plus the ranking.
- Store an entry only after its ranking led to an answer.
- Recheck the bars (0.53 / 0.80) as real lookups come in; add bench cases
  for a hit, a miss and a paraphrase.
