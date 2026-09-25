# Dead ends

Approaches tried while building features that did not work, and what
replaced them. Numbers are from the runs at the time (September 2026).

## Question kinds

- **Answering number and truth questions as passages** (`--kind passage` on
  the bench's number and truth questions). Numbers worked (the passage
  printed the right table row) but gave the whole row instead of the asked
  figures, so `number` stays. Truth failed: 5 of 6 questions produced no
  answer. A "false" membership ("Is Lockpick a perk?") is an absence no
  sentence states, and "Is witch a class?" found the Witch page but no
  sentence saying it is a class. `truth` stays.
- **Telling "each"/"every" figure questions apart by rewording the kind
  choice.** Every wording that sent "How much do each type of magazine
  cost?" to `passage` also sent "What is the cost, weight and damage rating
  of a combat rifle?" there. Replaced by a separate noul, `each`, asked in
  the same call; a number question with `each` ≥ 0.3 becomes a passage. The
  bar is under half because "What does every small gun weigh?" scores
  0.36–0.39 in every wording, against 0.07–0.18 for one thing's figures.
- **Table kind picked for "Show me the exotic weapons table"** 2 times in 6
  despite wording. Replaced by a rule: a table request naming no columns (or
  no rows) runs as a passage search.

## Tables to order and passage tables

- **Picking a table's columns with a yes/no per heading.** Lost COST (0.26)
  for "cost and weight of every small gun" and kept both DAMAGE RATING
  (0.59) and DAMAGE EFFECTS (0.55) for "damage". Replaced by one `choice` per
  quantity among the headings plus "none".
- **The column choice asked plainly** ("holds the drum magazine size") took
  the Standard Magazine column about half the time. Asking for "that very
  thing and not something like it" answers none at 0.84–0.98 there and
  still picks right elsewhere.
- **A table's note rows scored alone.** Each "Alt. Fire Modes: None" row
  under a weapon scored 0.08 against the rows' 0.82, breaking the table
  into one-row runs under the passage minimum, so the passage came back
  "not stated". A note row now takes its row's score.
- **Reading a table request with `readQuestion`'s quantities.** "ammo type"
  and "weapon skill" are not figures; the columns came out "size, size,
  size". A table request now reads its own words for rows and columns.
- **Assigning each request word to rows or columns by the higher score**
  turned "weapon skill" into "skill" and the rows into "each". Replaced by
  names that start at a word ≥ 0.5 and continue through words ≥ 0.3
  (`namesBy`), which also stopped "small guns" and "Barrel Mods" losing a
  word between readings.
- **Joining "of" inside every name** ("type of magazine") made the text
  search find no page where "type" and "magazine" did. "of" now joins only
  quantities and columns ("rate of fire").
- **Searching for the rows' table with every column in the question**
  ("What are the damage, ammo type, … of each …?") gated its page at 0.15.
  The rows search asks "Show me the table of all the {rows}" and columns
  come after.
- **Reading an entry's value with a choice per row.** jev doubted "Ammunition:
  Flare" (0.26–0.33) while taking every other gun's ammunition line. Replaced
  by one choice per column of the label the entries share.
- **Looking up a mod's cost with the question's column choice.** The question
  has a Cost column of its own (the gun's), so "the cost it asks for" chose
  none in the mod tables. The lookup now asks which column gives each of
  that table's rows' cost.
- **Matching leftover lookup items with jev.** It guessed: "Short" as
  "Short Scope" (+11) when the sights shared the table, then "Short" as
  "Sawed-Off" and "Stub Barrel" as "Snubnose" within the barrel group.
  Replaced by rows grouped under their one-cell group rows and matched by
  name or name plus the group's noun ("Long" under BARREL MODS is "Long
  Barrel"; "Marksman's" is "Marksman's Stock"); anything else is N/A.
- **A stricter row-matching prompt** ("not merely one sharing a word")
  stopped "Long Barrel" matching "Long". Reverted.
- **Pooling every annotated column's items** into one lookup matched a
  barrel's item among the sights. Each column is looked up on its own.

## Tables across the shelf

- **A higher bar for joining words inside a row's name** (0.8 for "in",
  "the", "and", 0.5 for the rest). jev rates a title's own words under even
  odds at times, "Legend" of "Legend in the Mist" at 0.36–0.49, so the row
  was lost in 2 of 6 readings. The same 0.8 bar cut "are" (0.77) and "does"
  (0.78) out of the columns' questions. Replaced by a run of words at 0.2 or
  more for a row, and at 0.5 or more for a column (see [tables.md](tables.md)).
- **"In Heart, how many skills are there?"** as the cell's question. It read
  the same kind as "how many skills are there in Heart?" for every count,
  but "In Fallout, healing work?" read as a truth where "healing work in
  Fallout?" read as a passage.

## Layout and the log

- **The paragraph gap rule** split a 9pt bullet item from its wrapped line
  (Fallout's mod lists: "Recoil-" / "Compensating Stock"). A hanging line
  within a line's pitch now stays in its item, and a hyphen before a capital
  stays.
- **The paragraph gap rule** also split a sentence where Fallout's 9pt text
  wraps around an illustration ("attacks with thrown" / "weapons like
  javelins"), leaving the second half a passage fragment that was cut. A
  line that ends no sentence, followed in its column within two type sizes
  by one starting lower case, now continues the paragraph.
- **A passage growing a fixed two pages** from the page it was found on
  stopped Fallout's skills at p.48, leaving out Unarmed on p.49. It now grows
  through its section and two pages past it.
- **Repeated highlight boxes** (one cost cell used by many guns) blended
  darker in viewers; boxes are drawn once per page.
- **Summary lines after their sub-lines** made the rows search's "ranked"
  line read as a separate step, adding up to more than the total. Steps
  with lines of their own now print a header first.
- **Parallel column searches** shared one token counter, so each section's
  count included the other search's calls. They run one at a time.

## Embeddings in place of jev

- **Ranking pages by embedding alone** (no jev ranking): the answer page in
  the top 1 for 9–12 of 23 bench questions against jev's 17 of 19; Heart's
  class list 101st, RadAway 43rd. Kept only as a shortlist for jev
  (docs/token-usage.md).
- **Embedding bars on the page check** (drop a page below a low bar, pass
  one above a high bar without asking jev). On 1,666 checked pages from 60
  questions: a low bar of 0.30 drops 141 pages (8% of check tokens) and no
  page jev passed; 0.32 drops 11% safely; 0.35 loses an answer page
  (Lockpick p.376 at 0.335). No high bar is usable: jev said no to pages up
  to 0.77 (T-60 armour p.144 at 0.771); at 0.70, 16 of 50 kept pages were
  jev no. Bars relative to a book's best page, or by rank, did worse. The
  page check is ~18% of bench tokens, so the safe bar saves 2–4% of a run,
  embedding pages as they are checked slowed a CPR table from 28 s to 98 s,
  and dropping pages changed jev's scores within a batch (the magazine
  page failed 3 of 3). Not built; `experiments/embed/embed-gate-and-rank.patch`
  holds it (`JEV_EMBED_GATE`) with the logging used to measure it.

## Known flaky, not fixed

- CPR "How much do each type of magazine cost?": p.344 gates between 0.61 and
  0.72 against the 0.7 threshold, so some runs find no page or take the
  ammunition page (p.346).
- CPR "How many skills are there in the game?" counts 32–61 of 66 run to
  run under either ranking, and once 86 when the contents step did not
  confine the walk.
