# Kinds of question and how each is answered

How the kind of a question is read, and how a count, a number, a
statement and a passage are read off a page. Tables have their own
document, [tables.md](tables.md).

## Kinds of question

jev classifies the question once, from its wording alone, and the output shape
follows.

| question | kind | output |
| --- | --- | --- |
| "How many classes are there in heart?" | count | `9  (p=1.00)` + link |
| "How much does the Umber cost?" | number | `80  (p=1.00)` + link |
| "Legend in the Mist uses a d20 for every roll." | truth | `false  (p=0.98)` + link |
| "How do I create a hero?" | passage | link + the sentences that answer |
| "How much does each type of magazine cost?" | passage | link + the table's rows that answer |
| "Make a table of every small gun with its cost and weight" | table | link + the table, a row a gun |

A figure for each of several things ("each type", "every gun") is asked on
its own beside the kind; a number question that asks it is read as a
passage, so the rows of the table print rather than one of its figures.
Several figures of one thing ("the cost, weight and damage rating of a
combat rifle") stay a number.

Because jev emits no text, every answer is a decision over options code
prepared, and the arithmetic stays in code. jev does not tally: it recognises
the shape of a count rather than counting, and the error grows with the list.

A count and a number are different questions. A count is a tally the page does
not state ("how many classes"). The candidates are the names the page sets
apart by type, read from `mutool`'s layout (`layout.ts`): a whole line in
one font, or the bold lead-in of a body line ("BLOCK: +1 Blood protection"),
outside the prose styles, with dot leaders and notes ("Martial Arts (x2)")
stripped. One `noul` per candidate asks whether it is exactly the name of one
entry of the kind asked about, with the page's `-layout` text in the state;
the yeses are counted, and since a book sets every entry of a list in one
style, only the yeses in the style most of them share count, which drops the
type headers over Legend in the Mist's theme kits and a "GUNS" off an
illustration beside the Fallout perks. A long list is summed across its
pages, each name once. A page that sets nothing apart, the manual fixture's
inline "Athletics, Barter, …", is cut into scraps instead: every line, table
cell or phrase between commas starting with a capital, at most four words.
Each candidate rides in its own question: shown the whole list at once, jev
put "Survival" at 0.4 beside "Survival covers foraging in" at 0.5; shown one
at a time, 0.9 and 0.1. The kind is read off the question in the same call
that classifies it, so the candidates are asked whether each is "one trope"
rather than "one of the things the question asks about"; asked the second
way, the theme kits listed under each trope counted as tropes.

A number is a figure the page does state ("how much does it cost", "how many
rads are lethal"), so the choices are the figures on that page, digits or
words, each shown with the text around it; nothing is summed, and a page
without figures is `not stated` without a call.

A statement asks three `noul`s of a page in one call: does the text state the
claim, does it contradict it, and does it list things of the kind the claim
names. Stated is `true`; contradicted is `false`, and so is a list of the
kind that does not name the thing, where whether it names it is a string
comparison over the page's cells, in code, so "Vermissian Knight" does not
name "knight". None of them is silence: the page is dropped and the walk
goes on, rather than a page that never mentions the claim answering `false`.
A `false` is as sure as the contradiction or the list; folding in the stated
noul's complement read 0.96 off a page that never mentioned the claim once
its list noul crossed 0.5. Each names the kind-word, since the classes page
otherwise had "Is heretic a calling?" stated at 0.5.

A question can ask for several figures. "What is the cost, weight and damage
rating of a combat rifle?" is split into words and each word is asked, in the
same call that classifies the question, whether it names a quantity the
question wants; adjacent words that do form one name, so `damage rating` stays
one. Then one choice per name goes out in one call over the page, and the
answer reads `cost 117, weight 11, damage rating 5`, with the confidence of
its least certain stated part. `not stated` is a refusal, not an
answer: the window is dropped and the walk goes on.

A passage question reads the answering stretch off the page. The page's text
is cut into sentences, each sentence is asked in its own `noul` whether it is
part of the answer, and the runs of sentences whose probabilities sum highest
above 0.65 are the passage, printed under the link a sentence a line, as sure
as their sentences are on average. The best run comes first, then the best of
what is left while a run still clears a minimum (one sentence near certain,
or two fairly sure), and what was left out between two runs prints as `…`:
Necromunda's eight phases of close combat are a heading and a paragraph
each, with an aside on unarmed attacks between the second and third that
one run would have stopped at. The bar sits above even odds because a
column's spillover on the Legend in the Mist creation page hung at 0.6 and
would have trailed the passage at 0.5, while a heading's 0.43 dip inside the
Fallout RadAway entry is outweighed by the sentences around it and kept. A
page with no sentence of the answer is dropped and the walk goes on.

A passage goes on past its page when the next page holds more of the
answer: it is laid out and its sentences asked, and kept if a run of its
own clears the minimum, through the rest of its section and up to two
pages past it. Necromunda's phases of close combat are listed on one page
and the last three explained on the next; Fallout's skills run over four
pages, p.46 to p.49, and a fixed two pages from the first left out
Unarmed. The
page before is never read: tried, it got in twice on its own account, the
weapons table before the exotic one and a page before hero creation, and
never held anything. The link lands on the page the passage starts on, and
`--highlight` marks every page it covers.

```console
$ bun jevsec.ts manual.pdf "How is radiation treated?"
(p=0.93)  manual.pdf p.3  Chapter III: Radiation  (found p=0.97)
  RadAway is stocked in the vault clinic and is dispensed by the doctor on request.
```

The text a passage is read from is the page as `mutool` lays it out, in
`layout.ts`: lines with their positions and fonts, put back into columns by
the left edges most lines share (three of them on Heart's equipment tags
page), into paragraphs by the gaps between lines, with running headers and
page numbers dropped from the margins and the weight of every character
kept. A heading is a line in display type; a bold entry name stays bold. A
line set across the columns, a heading or an intro, bands the page: what
stands above it in either column is read before it, so a list set in two
columns under an intro reads left column then right, not the right column
after the whole left one. A bullet set as a line of its own leads the line
beside it, and a drop cap leads its line with no space, where each had read
as a table cell next to its text. In
a terminal the passage prints wrapped to the window with its headings and
bold runs in bold; piped, it is plain text, a paragraph a line. A space
mutool drops between two words is put back from the gap in their character
boxes, which glued half of every line on Heart's pages. No extractor read these books in order on its own: `pdftotext`
interleaved the Fallout and Heart columns line by line, its `-raw` order
glued words together on Legend in the Mist, and `mutool`'s text glued words
on Heart; the positions in its `stext` are what the columns are rebuilt from.

Two probabilities print, and they mean different things: the answer's own
confidence, and `found p=…` for the window that produced it. Finding the right
pages and reading a value out of them fail independently.

Force a kind with `--kind count|number|truth|passage`.

### Answering from the table of contents

A book that lists its nine classes as nine outline entries already holds the
count. Before any page is opened, counts and statements are tried against the
contents:

```console
$ bun jevsec.ts heart.pdf "How many classes are there in heart?"
  toc   9 (p=1.00)  Characters > Classes  in 0.2s (jev 0.2s, read 0.0s, other 0.0s)
9  (p=1.00)  heart.pdf p.31  Characters > Classes  (found p=1.00)
```

A count asks jev which section's entries the question is about, then counts
them, so the number itself is exact rather than estimated. Below
`--answer-floor` the pick is discarded and the pages are read instead.

Counting bookmarks only holds while they are the list. Cyberpunk Red
bookmarks its skill list as nine groups, "Awareness Skills" and so on, and
the contents answered nine until, in the same call that picks the section,
each section's entries were asked whether they are groups of the things
rather than the things; they were, so the pages are read instead, and count
65 of the 66 skills at p=0.83. The Fallout rulebook
nests 89 of its 94 perks under the first perk, so its perks section lists one
perk and six statistics; an entry with more entries under it than its parent
has is where the list went, and the contents are abandoned for that section's
pages, whether jev picked the section or the entry the list went into; the
latter only when the section above is about the kind counted, "Step 4:
Choose Your First Perk" for perks, else a Classes list beside two childless
sections would send its whole chapter to the pages. How many pages an entry
takes is no signal: Heart gives each of its five callings two pages, and
five is the count.

Membership is decided in code, not by the model. "Is witch a class?" names a
category (`class`, matching the section `Classes`) and a subject (`witch`, the
words between "is" and "a class"), and both are string comparisons with exact
answers. The subject must equal an entry, so `knight` and `witch hunter` are
non-matches while `vermissian knight` matches.

**A positive is proof; a negative is only silence.** Finding an entry in the
contents settles the question. Not finding one settles nothing, because
contents summarize and a section may list three of its four classes, so a
negative is handed to the pages of that section, and only that section, to
confirm or overturn. Reading the whole book instead let the classes page answer
"Is heretic a calling?" with true. The section's chapter gets a say too, its
opening pages before its first section: Heart's callings each get two pages
of their own and none lists all five, but the Characters chapter does, on its
first page.

```console
Is witch a class in heart?    true  (p=1.00)   contents, no page opened
Is knight a class in heart?   false (p=0.90)   contents said no, the Vermissian Knight page agreed
Is heretic a calling?         false (p=0.95)   contents said no, the Characters opening agreed
Is witch hunter a class?      false (p=0.98)   contents said no, Classes pages agreed
```

A page confirms a negative only by contradicting the claim or by listing the
things of its kind without the name, whole cells only, so a page that never
speaks to the claim is dropped and the walk goes on; this is what makes a
positive off a fragment ("knight" beside "Vermissian Knight") stay false.

A count the contents cannot settle is confined the same way: they say which
section holds the list, and the pages of that section are read to count it.

`--no-toc` skips this stage entirely.

### Counting a list longer than one window

A list of 94 perks over 16 pages does not fit one call, so each window is
counted on its own and the parts are added up, reported as they land:

```console
  yes  0.91   0.3s jev  Gadgets p.1 (window 1/3)
    + 10 (p=1.00)  p.1  running 10
    + 10 (p=1.00)  p.2  running 20
    + 10 (p=1.00)  p.3  running 30
  take  30 (p=1.00)  Gadgets p.1 (window 1/3)
```

Counting a section reads every page under it, so its subsections are skipped
rather than re-counted, and any count already taken off one of its pages is
dropped as a fragment of the same list rather than kept as a fallback. The
link goes to the first page that counted something and that the gate did not
call a no (under 0.5): Heart's nine classes sit on the second page of their
section, the first lists none, and the page before its domains list mentions
one domain in passing at gate p=0.10.

A window's count is as sure as the share of its scraps that were decided
clearly (at or above 0.7, against those between 0.3 and 0.7), and the
aggregate as sure as its least certain counted part, so that is the confidence
reported. A page of 91 theme kits with 6 in doubt is a count; a page of 3
tropes with 16 in doubt is not; and the least sure of 91 scraps says little
about either.
A window listing none of the items neither adds nor lowers it, since a long
section is expected to have some. A part below `--answer-floor` is left out
and marked `?`. The confidence is then scaled by the share of the section that
was counted, so three sure pages of a 36-page section do not pass as a count
of it.

A statement changes the gate as well: a negative has no answer for a page to
contain, so Heart's class list gated at 0.32 for "Is knight a class?". A
statement's gate is three `noul`s per page in the same call, the same three
the answer is read with, does the page state the claim, contradict it, or
list things of its kind, and the page passes on the highest; the class list
then gates at 0.94 and answers knight false from there rather than from the
Vermissian Knight's own page. Since those are the three the answer is read
with, a page that passes is answered off its gate nouls, with no second call.

A count also changes what a window has to satisfy to be worth reading. No page
says "there are 94 perks", so asking whether a window "contains the answer"
rejects the very pages the perks are listed on; a count asks whether the window
lists entries of the kind in question instead.

### Counts and statements keep looking

A section can plainly be about theme kits while the count inside it comes
back unsure. So for count, number and truth questions the extracted answer
must clear `--answer-floor` (default 0.7) too; below it, the walk continues,
and the second page of Legend in the Mist's kit list, which sits at the
floor, is counted one run and left out the next:

```console
    + 88 (p=0.88)  p.76  running 88
    ? 62 (p=0.28)  p.77  unsure, left out
  keep  88 (p=0.47)  … > List of All Theme Kits p.76 (window 1/2)   ← below floor, keep walking
jevsec: no answer reached p=0.7 in 1 windows; best follows
88  (p=0.47, below 0.7)  Legend-in-the-Mist-Core-Book.pdf p.76  … > List of All Theme Kits  (found p=0.77)
```

Nothing is hidden: if no answer clears the floor, the best one still prints,
marked, and the exit code is 1. `--max-answers N` (default 5) bounds how many
windows get read out before settling.

## Limits

- **A count from the contents trusts the contents.** A section listing three of
  its four classes yields three, with no page read to check. Membership has a
  safeguard for this, a negative being confirmed against the pages; a count has
  only the checks for a list that went into one entry and for entries that are
  groups of the things.
- **Counting is only as good as the candidates.** A name set in the prose
  style, one over 60 characters, or one split across a line break is never
  offered, so it is never counted; a list set in two styles keeps only the
  larger. On a page with nothing set apart, the scraps miss a name not
  starting with a capital or over four words, and cut "Sword and Board" in
  two, since the inline list "Science and Survival" has to be. Measured, on
  the shelf's two-column rulebooks: Fallout's 94 perks over 16 pages as 94
  at p=0.80 (scraps said 95; the choice over numbers before them, 80 at
  p=0.36), its 17 skills as 17. Legend in the Mist's 20 theme types as 20
  (scraps 19), its 153 theme kits as 152 at p=0.72 (scraps flipped between
  150, 88 and 152, the second page sitting at the floor); its 30 tropes are
  answered from the contents as ten groups, and read from the pages come to
  29 (scraps refused). Cyberpunk Red's 66 skills as 61 at p=0.75 (scraps
  64). `bun run bench` reruns all of these.
- **The category matcher is loose.** It takes any section whose name appears in
  the question, so "Is Brotherhood Initiate an origin?" can match a section
  named `Brotherhood`. A wrong match now costs a page read rather than a wrong
  answer, but it still costs one.
- **The text search finds words, not meanings.** A question whose subject the
  book names another way ("healing" for "first aid") finds nothing, and the
  walk is back to titles. The floors are soft: files and sections under them
  are read, in rank order, only while nothing has answered, so such a book is
  still reached within `--max-files` and `--max`. Above the floor `-n`
  windows are collected; below it one is enough. It just costs the reads
  above it first.
- **Scanned PDFs are invisible.** Extraction is text-only; no OCR.
- **Probabilities move between runs.** jev is not deterministic at the margins,
  so a borderline window can flip either side of a threshold.
