# jev

Search a shelf of PDFs by asking a question instead of grepping for a string.

Three tools, built on [jev](https://openrouter.ai/~typesafe/jev-latest), a
decision model that returns calibrated probabilities rather than text. It never
writes prose, so nothing here summarizes or paraphrases: every answer is a
number, a true/false, or a page to go read.

```console
$ find /shelf -name '*.pdf' | bun jevfind.ts "How does hero creation work in Legend in the Mist?"
question looks like a passage question
ranked 353 paths in 0.4s (jev 0.4s, read 0.0s, other 0.0s), 1 above file floor 1.5 (352 below)
2.96  Legend in the Mist/Legend-in-the-Mist-Core-Book.pdf
  ranked 169 sections in 0.4s (jev 0.4s, read 0.0s, other 0.0s), 67 above title floor 1 (102 below)
    gated 2 pages (batch 1/1), 0.2s jev, 1 yes  … > Hero Creation
    take  HERO CREATION… (p=0.91)  … > Hero Creation p.73 (window 1/2)
  file 1.1s (jev 0.9s, read 0.2s, other 0.0s)  2 windows read
total 52.1s (jev 1.8s, read 0.2s, stdin 50.1s, other 0.0s), 1 files opened, 2 windows read
(p=0.91)  Legend-in-the-Mist-Core-Book.pdf p.73  … > Hero Creation  (found p=0.96)

  HERO CREATION

  You can create any hero you can dream of, by describing them with tags.

  The Simplest Way: Just Write It Down

  • Think of their four themes and write them as power tags.
  …
```

353 PDFs, one file opened, two pages read, 1.8 seconds of jev; the other
fifty were `find` walking a spinning disk, see [Where the time
goes](#where-the-time-goes). The link is clickable and lands on page 73; the
passage under it is the page's own text, headings in bold.

## Setup

```sh
bun install
echo 'OPENROUTER_API_KEY=sk-or-v1-...' > .env
```

Needs `mutool` (mupdf), `pdftotext` (poppler) and `rg` (ripgrep) on `PATH`.
Tables are read with pdfplumber: `bun run tables:install` puts it in `.venv`
with uv; without it, tables are read as text and the log says so once. The key is
read from the environment, or from `.env` next to the scripts, so the tools work
from any directory.

## The three tools

### jevgrep — which filenames could answer this?

Ranks names on stdin. Reads no file contents, so it costs one call for the whole
list and works on names alone.

```console
$ ls fixture | bun jevgrep.ts "What are the skills in the fallout rpg?"
2.99  fallout-skills-and-perks.md  Directly names the subject of the question (p=1.00 conf=0.99)
2.06  fallout-character-sheet.md   Plausibly holds part of the answer (p=0.66 conf=0.65)
1.77  manual.pdf                   Plausibly holds part of the answer (p=0.61 conf=0.55)
1.71  manual.ms                    Plausibly holds part of the answer (p=0.59 conf=0.51)
```

Scores run 0–3. Output is aligned for a terminal and tab-separated when piped,
so `jevgrep -l` feeds `xargs` cleanly.

| flag | meaning |
| --- | --- |
| `-n, --top N` | keep only the N best |
| `-t, --threshold F` | minimum score, 0–3 (default 1.5) |
| `-l, --names-only` | print names only, pipe-clean |
| `--json` | full rows as JSON |

### jevsec — which page of this PDF answers it?

Ranks the PDF's outline by section title, and beside the titles the pages
whose text mentions what the question is about, then reads best-first and
stops at the first page whose text actually answers.

```console
$ bun jevsec.ts book.pdf "How do I create a hero?"
question looks like a passage question
ranked 169 sections in 0.5s, 79 above title floor 1 (90 below)
  gated 2 pages (batch 1/1), 0.3s jev, 1 yes  … > Hero Creation
  take  HERO CREATION… (p=0.92)  … > Hero Creation p.73 (window 1/2)
(p=0.92)  book.pdf p.73  … > Hero Creation  (found p=0.96)

  HERO CREATION

  You can create any hero you can dream of, by describing them with tags.

  The Simplest Way: Just Write It Down

  • Think of their four themes and write them as power tags.
  …
```

`-n, --hits N` keeps walking until N passages have passed the threshold and
prints them all, best first within a section. Passage questions only: a
count, number or statement has one answer.

### jevfind — which page of which PDF answers it?

The whole cascade: rank the paths by name and by the pages in them that
mention the subject, then rank each file's sections the same way, then read.
Stops at the first confident answer anywhere.

```sh
ls *.pdf | bun jevfind.ts "How is radiation treated?"
plocate '*.pdf' | bun jevfind.ts "How many perks can a character take?"
```

Prefer `plocate` to `find` on a spinning disk — see [Where the time
goes](#where-the-time-goes).

### Searching the text

A title or a filename says nothing about much of what a book holds. Fallout's
small guns table sits under `Equipment > Small Guns`, fourteenth by title for
"what is the cost, weight and damage rating of a hunting rifle?", and the
`Hunting Rifle` bookmark two pages later is the weapon's description, not its
row. So before the titles are ranked, the book's text is searched for the
question's subject, and the pages found are ranked in the same call as the
titles, as candidates of their own:

```console
$ bun jevsec.ts fallout.pdf "What is the cost, weight and damage rating of a hunting rifle?"
question looks like a number question
asks for cost, weight, damage rating
searches for hunting rifle
ranked 1058 sections and 20 excerpts in 2.4s, 60 above title floor 1 (1018 below)
  no   0.04  Equipment > Small Guns > .44 Pistol > Hunting Rifle p.99
  no   0.05  Survival > Scavenging > Loot Tables > Weapons (Ranged) p.206
  yes  0.98  Equipment > Small Guns p.97 (excerpt)
  take  cost 55, weight 10, damage rating 6 (p=0.99)  Equipment > Small Guns p.97 (excerpt)
cost 55, weight 10, damage rating 6  (p=0.99)  fallout.pdf p.97  Equipment > Small Guns  (found p=0.98)
```

The subject comes off the question in the same call that reads its kind: a
noul per word, "is part of the name of the thing the question is about", so
"hunting rifle" is looked for and "cost", "weight" and "damage rating" only
count for a little. The looking is one `rg` over the cached texts, every
term a pattern, the whole shelf in one call and a few milliseconds; only
the lines it returns are scored. Each of the book's pages is scored by its
best line: the subject as a phrase, then its words, then any other content
word, each weighted by how rare it is across the book, so a line holding
"hunting" (nine pages) beats one holding "cost" (a few hundred); among pages
with the same best line, the one naming the subject on more lines ranks
first, which is what tells a list of skills from a page that mentions one.
The twenty best pages
go into the ranking call as `excerpts`, each as its page number and that line,
and the model scores them on the rubric the titles get. A page that wins is
read on its own, named for the section it lies in; the excerpt pages are
gated together, a batch at a time, when the first of them comes up, one
call for twenty pages rather than one each. A page read once is never
read again under its section, and the other way round (a window of several
pages under `--whole-windows` is read whole). A count ranks the
titles alone: a page dense with the subject is as likely a fragment of the
list as the list itself, and Legend in the Mist's ten theme kits on one page
counted as ten at p=0.82.

When the contents already named a section to read, only that section's pages
are searched: the walk was confined for a reason, a page outside it having
answered a membership question wrongly before.

`--no-search` ranks the titles alone. In jevfind every readable PDF on stdin
is searched, three pages each, but a name that clears the file floor is
trusted over any page: a supplement's page on perks outranked the core
rulebook's name for "what are the available perks in fallout" and answered
from armor mods. Below the floor, where the names say nothing, a file's
best page orders it instead, still under the floor; the log says so
(`1.49  starter.pdf  (by p.12)`). The game's name in the question is never
a search term: "fallout" is on every page of the Fallout book and on a few
of every other. The
first run over a shelf extracts every book, four at a time (a few seconds
each for a 400-page rulebook); after that the search costs nothing you can
see, and one pdftotext cannot read is logged and skipped.

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
own clears the minimum, up to two pages on. Necromunda's phases of close
combat are listed on one page and the last three explained on the next. The
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

## Reading the log

Progress goes to stderr, the answer to stdout, so `2>/dev/null` leaves just the
answer and `>file` keeps just the log. Indentation tracks the cascade: files at
the left margin, sections at two spaces, windows at four.

| line | meaning |
| --- | --- |
| `yes 0.96` / `no 0.24` | window holds the answer, or not |
| `take` / `keep` | the extracted answer cleared the floor, or did not |
| `--` | skipped without spending a call: not a PDF, no outline, no text |
| `section` / `file` / `total` | elapsed time for that scope, and what jev read and wrote in it |

A step that called jev ends its timing with the tokens it spent and their
cost at jev's input price, `DOLLARS_PER_MILLION_IN` in `shared.ts`:

```
total 8.2s (jev 3.8s, read 2.9s, other 1.6s; 189,609 tokens in, 24,445 out, $0.00796)
```

jev's output tokens are free, so the cost is the input's alone; they are
counted all the same. A step that spent no call says nothing of tokens.

## Where the time goes

Every span splits into `jev` (inference), `read` (mutool/pdftotext), `stdin`
(waiting on whatever is feeding the pipe) and `other`. That split exists because
this is I/O bound, not inference bound:

```
total 105.4s (jev 3.3s, read 15.9s, stdin 86.2s, other 0.0s)
```

86 seconds of that was `find` walking a spinning disk before the first call went
out. `plocate` reads an index instead and makes it disappear.

A book's text is extracted once, whole, and kept under `~/.cache/jev` (or
`$XDG_CACHE_HOME/jev`) keyed by the file's path, size and mtime: the text
search runs `rg` over those files before a section is picked, and a second
question to the same book should not pay for `pdftotext` again. The first
run on a 400-page rulebook spends two to eight seconds there; after that
`read` is `rg` and the cache file of whatever book is opened.

## PDFs without an outline

There are no titles to rank, so the pages the text search found are ranked
and read first, and the rest of the document is cut into page windows and
read in page order, `--max` of them: a shelf search opened two 400-page
books on a page each and then read every page of both, seven minutes for
no answer. Raise `--max` to read a whole book. Ranking those windows by
their opening text was tried and removed: a 300-character snippet put a
credits page above the body, and since the walk stops at the first yes,
order only costs latency.

## Tables

Text is extracted with `pdftotext -layout`, which keeps a table row on one line
and two prose columns side by side. In reading order the columns came out
interleaved line by line and each table cell on a line of its own, three lines
from its label. A figure's choice carries its row: "5, as in: Combat Rifle
5C …", and on the Fallout small guns table a combat rifle's cost, weight and
damage rating come off together as `117, 11, 5` at p=0.90; read in reading
order, the cost and weight sat at p=0.59 and the damage rating went unanswered.
A figure may carry a unit on its tail (`5CD`, `10mm`) but never a letter on its
head (`v2.5`, `p12`). A figure on several rows is offered once per row, up to
three, since the `5` in the header and the `5` in the Combat Rifle row are told
apart only by their rows and jev cannot pick a row it was never shown.

## Tables as records

A table on the page is read into a record a row before the model sees it.
pdfplumber (`tables.py`) finds a table by its ruling lines and cell shading,
which is what a rulebook draws one with, and reads a name wrapped over two
lines as one cell: Cyberpunk Red's ranged weapons, "Grenade" over
"Launcher" with the stats on the line between, came out of `pdftotext` as
four lines and out of a layout parser as two rows. A row prints as one line
of JSON, keys as the book sets them, set where the table stood; a row of one
cell ("Alt. Fire Modes & Special Features: None" under a weapon) stays a
line of its own, and a repeated or empty head is numbered:

```
{"SMALL GUN":"Combat Rifle","WEAPON TYPE":"Small Guns","DAMAGE RATING":"5 CD","DAMAGE EFFECTS":"–","DAMAGE TYPE":"Physical","FIRE RATE":"2","RANGE":"M","QUALITIES":"Two-Handed","WEIGHT":"11","COST":"117","RARITY":"2"}
```

A number question reads its page this way, so a figure sits beside its
column head rather than loose on a line; a passage that lands on a table
reads its rows as records, each row one sentence of the passage, and prints
them in a terminal as a grid under the heads (a head and its cell a line
when too wide for the window; JSON a row when piped):

```
  Small Gun      Damage  Weight  Cost
  .44 Pistol     6       4       99
  Combat Rifle   5       11      117
```

A passage question that names quantities keeps only their columns, beside
the first, which names the row. Each quantity picks one column of each
table ("damage" is Fallout's DAMAGE RATING, not its DAMAGE EFFECTS too), and
the notes under the rows go; a table where no quantity has a column stays
whole. "What is the damage of all the standard ranged weapons?" in Cyberpunk
Red:

```
  Weapon Type        Single Shot Damage
  Medium Pistol      2d6
  Heavy Pistol       3d6
  Very Heavy Pistol  4d6
```

A note under a row, "Alt. Fire Modes & Special Features: None" under each
weapon, counts toward the passage as its row does; judged alone it sat far
below the bar and broke the table into runs of one row, too small to show.

The gate
still reads the `pdftotext` text. A table drawn without rules or shading is
not found and reads as text. A letter in a column ("RANGE": "M") is not a
figure and a number question cannot read it yet.

## Tables to order

A question that asks outright for a table ("give me a table", "make a
table") with a row for each of some things and the columns it names is a
`table` question, built by `compose.ts`:

```
$ bun jevsec.ts cpr.pdf "Give me a table that contains each of the standard ranged weapons as a row. \
    For each row give me single shot damage, ammo type, weapon skill, rate of fire, \
    standard magazine size, extended magazine size and drum magazine size"

  Weapon Type        single shot damage  ammo type  weapon skill   rate of fire  standard magazine size  extended magazine size  drum magazine size
  Medium Pistol      2d6                 M Pistol   Handgun        2             12 (M Pistol)           18                      36
  …
  Bows & Crossbows   4d6                 Arrow      Archery        1             N/A (Arrow)             N/A                     N/A
  Rocket Launcher    8d6                 Rocket     Heavy Weapons  1             1 (Rocket)              2                       3
```

1. jev reads the request a word at a time: the first name of the things
   the rows are for ("standard ranged weapons"), and the columns, an "of"
   kept inside one ("rate of fire"). The rows' own words are never columns.
2. A passage search for the rows' table ("Show me the table of all the
   standard ranged weapons") gives the rows, its first column their names.
   Each column picks a column of that table, as a passage's quantities do.
3. A column still missing is looked for in each row's own entry on the
   pages after the table (`ENTRY_PAGES` of them): the paragraphs under a heading that is the row's name
   (".44 PISTOL"). jev picks, once per column, the label the entries give
   it under ("Ammunition" for ammo type), and each entry's line with that
   label is the row's value, so every row reads the same line.
4. Each column still missing gets a search of its own, collecting up to
   three passages; every table those find is offered for every missing
   column, since the extended sizes' search may find the drum sizes too.
5. Another table's rows are matched to ours by name, then by asking jev for
   the rest.
6. Any cell still empty, a row without an entry or one another table lacks,
   is read from the row's own cells, a choice among their pieces: "M
   Pistol" out of "12 (M Pistol)". None is N/A.

A request can also ask for something beside each item of a column: "For
each Mod column add the cost of the mod in parenthesis".

```
  SMALL GUN      Damage  Sight Mods
  .44 Pistol     6 CD    Short Scope (+11), Reflex Sight (+14), Recon Scope (+59)
  Assault Rifle  5 CD    Reflex Sight (+14), Short Scope (+11), Long Scope (+29), …
```

jev reads what to add ("cost") and which columns it goes on apart from the
columns themselves, so "Mod" in "each Mod column" is not a column. Each
cell is split into items at its commas, semicolons and bullets, and each
column's items are looked up on their own in the tables on the pages from
the rows' table on, nearest first: the same mod can cost differently in a
weapon's own table further on, and the nearest is the one for the rows'
kind. jev picks each table's column for what to add and, where the rows
fall in groups ("BARREL MODS", "SIGHT MODS"), the group for the column, so
a barrel's "Short" is never a sight's "Short Scope". A row names an item by
its name, or by its name and the group's noun ("Long" under BARREL MODS is
"Long Barrel"); an item named neither way is `(N/A)`, not a guess. A cell
that stands for no value ("None", "–") is left as it is. Each looked-up
cell is highlighted once, however many rows used it. Words of the request start a name only where
jev is sure of them and carry one on where it half believes them, since
"guns" of "small guns" sits either side of even odds from one reading to
the next.

When the rows' passage holds several tables, jev picks the one with a row
for each of the things; a heading or prose between two tables with the
same heads keeps them apart.

The table prints, pipes and highlights as a passage's rows do, each cell
marked on the page it came from. A table request that names no columns
("show me the exotic weapons table") wants the book's own and is read as a
passage. Piped, a row is a line of JSON; `--tsv` prints heads and rows
tab-separated, for a built table and a passage's table alike, with the link
on stderr so stdout is the table alone. A table found but with no column
for any row is not an answer: it prints as the best found and exits 1. The full
request takes about twenty seconds, most of it the column searches.

## The exact page

Every page of a section is gated on its own, so the hit is the page that
answered:

```console
$ bun jevsec.ts catalogue.pdf "How much does the Fen Gasket cost?"
  gated 24 pages (batch 1/1), 0.3s jev, 1 yes  Catalogue
  no   0.01  Catalogue p.1 (window 1/24)
  …
  yes  0.99  Catalogue p.24 (window 24/24)
catalogue.pdf p.24  Catalogue  (found p=0.99)
```

The pages go out together, one question per page over one state, in batches of
`--chars` characters, in order, stopping at the first batch that answers. So a
per-page walk spends the same calls as a whole-window walk and stops at the same
place; only the resolution changes. Batching is not only cheaper than a call per
page, it is sharper: shown the pages side by side the model contrasts them. On that
24-page section the runner-up page sat at 0.03 batched and at 0.33 when each
page was asked alone, and smaller batches were in between (six pages per call
0.67 mean margin, twelve 0.89, all twenty-four 0.97). The best page is read
first, not the first page over the threshold.

A count still sums the pages of a section, counted in parallel.

`--whole-windows` gates a window of `--chars` characters at a time instead, one
`noul` per call. A window is tagged with its first page, so a count or figure
hit in a 16-page section then links to where the section starts; at `--chars
12000` a 28-page PDF becomes 6 windows and a hit lands on page 10 rather than
page 1. A passage is read across every page of the window and links to, and
highlights, the page it starts on. It costs the same calls and is less sharp,
so it is only there for comparison: at `--chars 12000` the equipment tags
question stopped at the first window over 0.7, the equipment examples on
p.99, where page by page it reads the tags on p.102.

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

## An open model instead of jev

`--model semif` answers from [SemIf](https://github.com/TheoLeeCJ/SemIf), an
open reimplementation of the same interface: typed option probabilities read
off a local model's logits, Qwen3.5-4B here. `semif/server.py` keeps the model
loaded and takes the same `systemOne` request over HTTP, so nothing above the
client knows which is answering.

```sh
bun run semif:install     # Python 3.12 venv in semif/.venv, SemIf pinned, bitsandbytes
bun run semif:serve       # downloads Qwen3.5-4B once, loads it in 4-bit, listens on :8765
bun jevsec.ts --model semif --chars 12000 book.pdf "Is heretic a calling?"
```

Measured on an RTX 4060 laptop (8 GB) against jev on the same questions:

| call | SemIf | jev |
| --- | ---: | ---: |
| one gate or truth question | 0.15–0.3s | 0.2–0.3s |
| rank 40 titles | 1.9s | 0.3s |
| gate 24 pages in one call | 8.2s | 0.3s |
| live test suite, as it then stood (126 tests) | 34s, 121 pass | 12s, all pass |

At parity on small decisions, and free and offline. Not a match on pages:
prefill runs at about 1,500 tokens a second, a 12k-token batch runs the card
out of memory (hence `--chars 12000`), and the pages of a section are less
sharply told apart (a wrong page at 0.75 beside the right one at 0.95, where
jev held it under 0.05). A count asks a `noul` per scrap of the page, a
hundred or more per page, each a pass over the same text.

## Tests

```sh
bun test            # offline, free
bun run test:live   # calls jev, spends tokens
bun run bench       # the shelf: real rulebooks, named in .env
```

## The shelf benchmark

`bench.ts` runs every case worked through on the real rulebooks, Heart,
Fallout, Legend in the Mist and Cyberpunk Red, through the same layers the
CLI uses, and scores each against the true answer: a count by how close, a
statement by right or wrong, a passage by the share of its checks met (the
page, the strings it must and must not contain, their order). It prints a
table with the last run's score beside each, marks a case that fell, and
writes the run to `bench/latest.json`, which is committed, so the history is
in git. Cases known to come out wrong stay in the table with the reason, so
the gap is visible rather than hidden.

```sh
bun run bench            # all cases, then write bench/latest.json
bun bench.ts heart       # cases whose book or question matches; not saved
bun bench.ts --no-save   # compare without replacing the last run
```

The books are not redistributable, so each is named by an environment
variable (`JEV_HEART_PDF`, `JEV_FALLOUT_PDF`, `JEV_LITM_PDF`, `JEV_CPR_PDF`)
read from `.env`, and a case whose book is unset is skipped.

The live tests are gated behind `JEV_LIVE=1` and assert only the direction of an
answer, never an exact probability. Fixtures are generated PDFs with their
`groff` sources in `fixture/`; rebuild them with `bun run fixture:build`.

## Layout

| file | role |
| --- | --- |
| `jevgrep.ts` | rank names from stdin |
| `jevsec.ts` | search one PDF |
| `jevfind.ts` | rank paths, then search them |
| `pdf.ts` | outline, the text cache, page windows, the walk, links |
| `search.ts` | search terms and the pages that mention them |
| `layout.ts` | a page's lines, columns, paragraphs, tables and weights, for passages |
| `tables.py` | pdfplumber script printing a page's tables as JSON |
| `answer.ts` | classify the question, read counts and true/false |
| `compose.ts` | build a table to the question's design from several passages |
| `shared.ts` | client, key, the ranking call, scoring rubric, timing |
| `format.ts` | column alignment and path elision |
| `bench.ts` | the shelf benchmark over real rulebooks |
| `outline.js` | mutool script printing `path<TAB>start<TAB>end` |

## Highlighting the answer

`--highlight` links to a copy of the PDF, in `~/.cache/jev/` under a name
that carries a hash of the path so two shelves' `manual.pdf` stay apart, with the
passage's lines marked by a highlight annotation on its page, so the link
lands on the answer rather than the page. Any viewer that draws annotations
shows it. The copy is made afresh each run, since a highlight saved into it
stays there, and every hit in the same file adds its own; the Fallout
rulebook's 248 MB take about a second to copy. `--open` opens the copy. A
count, number or statement links to the page as before.

A table's row is marked a cell at a time, so a passage that keeps only the
asked columns marks only those cells: the weapon and its damage, not its
magazine and cost.

```sh
bun jevsec.ts --highlight --open book.pdf "What skills are there?"
```

## Clicking the link at the page

The printed link is an OSC 8 hyperlink carrying `#page=N`. `xdg-open` truncates
a `file://` URL at the `#`, so anything routed through it lands on page 1.
`--open` sidesteps that by launching the PDF handler directly. For clicks in
kitty, match the mime type in `~/.config/kitty/open-actions.conf`:

```
protocol file
mime application/pdf
action launch --type=background -- google-chrome-stable $URL
```
