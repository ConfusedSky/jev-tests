# jev

Search a shelf of PDFs by asking a question instead of grepping for a string.

Three tools, built on [jev](https://openrouter.ai/~typesafe/jev-latest), a
decision model that returns calibrated probabilities rather than text. It never
writes prose, so nothing here summarizes or paraphrases: every answer is a
number, a true/false, or a page to go read.

```console
$ ls *.pdf | bun jevfind.ts "How does hero creation work in Legend in the Mist?"
ranked 52 paths in 0.4s (jev 0.4s, read 0.0s, other 0.0s), 1 above file floor 1.5 (51 below)
2.91  Legend-in-the-Mist-Core-Book.pdf
  ranked 169 sections in 0.5s (jev 0.5s, read 0.0s, other 0.0s), 12 above title floor 1 (157 below)
    yes  0.96   0.3s jev  Core Book Vol. I > Hero & Fellowship Creation > Hero Creation p.73
  file 0.8s (jev 0.7s, read 0.1s, other 0.0s)  1 windows read
total 1.2s (jev 1.1s, read 0.1s, other 0.0s), 1 files opened, 1 windows read
Legend-in-the-Mist-Core-Book.pdf p.73  … > Hero Creation  (p=0.96)
```

52 PDFs, one file opened, one page read, 1.2 seconds. The last line is a
clickable link straight to page 73.

## Setup

```sh
bun install
echo 'OPENROUTER_API_KEY=sk-or-v1-...' > .env
```

Needs `mutool` (mupdf) and `pdftotext`/`pdfinfo` (poppler) on `PATH`. The key is
read from the environment, or from `.env` next to the scripts, so the tools work
from any directory.

## The three tools

### jevgrep — which filenames could answer this?

Ranks names on stdin. Reads no file contents, so it costs one call for the whole
list and works on names alone.

```console
$ ls fixture | bun jevgrep.ts "What are the skills in the fallout rpg?"
2.98  fallout-skills-and-perks.md  Directly names the subject of the question (p=1.00 conf=0.98)
2.18  fallout-character-sheet.md   Plausibly holds part of the answer (p=0.66 conf=0.64)
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

Ranks the PDF's outline by section title, then reads sections best-first and
stops at the first whose text actually answers.

```console
$ bun jevsec.ts book.pdf "How do I create a hero?"
question looks like a passage question
ranked 169 sections in 0.5s, 12 above title floor 1 (157 below)
  yes  0.97   0.3s jev  … > Hero Creation p.73
book.pdf p.73  … > Hero Creation  (found p=0.97)
```

`-n, --hits N` keeps walking until N passages have passed the threshold and
prints them all, best first within a section. Passage questions only: a
count, number or statement has one answer.

### jevfind — which page of which PDF answers it?

The whole cascade: rank the paths by name, then rank each file's sections, then
read. Stops at the first confident answer anywhere.

```sh
ls *.pdf | bun jevfind.ts "How is radiation treated?"
plocate '*.pdf' | bun jevfind.ts "How many perks can a character take?"
```

Prefer `plocate` to `find` on a spinning disk — see [Where the time
goes](#where-the-time-goes).

## Three kinds of question

jev classifies the question once, from its wording alone, and the output shape
follows.

| question | kind | output |
| --- | --- | --- |
| "How many themes does a hero have?" | count | `4  (p=0.97)` + link |
| "How much does the Umber cost?" | number | `80  (p=0.99)` + link |
| "Legend in the Mist uses a d20 for every roll." | truth | `false  (p=0.99)` + link |
| "How do I create a hero?" | passage | link + the sentences that answer |

Because jev emits no text, every answer is a decision over options code
prepared, and the arithmetic stays in code. jev does not tally: it recognises
the shape of a count rather than counting, and the error grows with the list.

A count and a number are different questions. A count is a tally the page does
not state ("how many classes"). The page is cut into every scrap that could be
a name, a line, a cell of a table row, a phrase between commas, starting with
a capital and at most four words, and one `noul` per scrap asks whether it is
exactly the name of one entry of the kind asked about; the yeses are counted,
and a long list is summed across its pages. Each scrap rides in its own
question: shown the whole list of scraps at once, jev put "Survival" at 0.4
beside "Survival covers foraging in" at 0.5; shown one at a time, 0.9 and 0.1.
The kind is read off the question in the same call that classifies it, so the
scraps are asked whether each is "one trope" rather than "one of the things
the question asks about"; asked the second way, the theme kits listed under
each trope counted as tropes.

A number is a figure the page does state ("how much does it cost", "how many
rads are lethal"), so the choices are the figures on that page, digits or
words, each shown with the text around it; nothing is summed, and a page
without figures is `not stated` without a call.

A statement asks three `noul`s of a page in one call: does the text state the
claim, does it contradict it, and does it list things of that kind without
the one named. Stated is `true`, the other two are `false`, and none of them
is silence: the page is dropped and the walk goes on, rather than a page that
never mentions the claim answering `false`. Each names the kind-word, since
the classes page otherwise had "Is heretic a calling?" stated at 0.5.

A question can ask for several figures. "What is the cost, weight and damage
rating of a combat rifle?" is split into words and each word is asked, in the
same call that classifies the question, whether it names a quantity the
question wants; adjacent words that do form one name, so `damage rating` stays
one. Then one choice per name goes out in one call over the page, and the
answer reads `cost 410, weight 34, damage rating not stated`, with the
confidence of its least certain stated part. `not stated` is a refusal, not an
answer: the window is dropped and the walk goes on.

A passage question reads the answering stretch off the page. The page's text
is cut into sentences, each sentence is asked in its own `noul` whether it is
part of the answer, and the run of sentences whose probabilities sum highest
above 0.65 is the passage, printed under the link a sentence a line, as sure
as its sentences are on average. The bar sits above even odds because a
column's spillover on the Legend in the Mist creation page hung at 0.6 and
would have trailed the passage at 0.5, while a heading's 0.43 dip inside the
Fallout RadAway entry is outweighed by the sentences around it and kept. A
page with no sentence of the answer is dropped and the walk goes on.

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
kept. A heading is a line in display type; a bold entry name stays bold. In
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
  toc   9 (p=0.89)  Characters > Classes  in 0.2s (jev 0.2s, read 0.0s, other 0.0s)
9  (p=0.89)  heart.pdf p.31  Characters > Classes  (found p=0.89)
```

A count asks jev which section's entries the question is about, then counts
them, so the number itself is exact rather than estimated. Below
`--answer-floor` the pick is discarded and the pages are read instead.

Counting bookmarks only holds while they are the list. The Fallout rulebook
nests 89 of its 94 perks under the first perk, so its perks section lists one
perk and six statistics; an entry with more entries under it than its parent
has is where the list went, and the contents are abandoned for that section's
pages, whether jev picked the section or the entry the list went into. How many pages an entry takes is no signal: Heart gives each of its five
callings two pages, and five is the count.

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
things of its kind without the name, whole names only, so a page that never
speaks to the claim is dropped and the walk goes on; this is what makes a
positive off a fragment ("knight" beside "Vermissian Knight") stay false.

A count the contents cannot settle is confined the same way: they say which
section holds the list, and the pages of that section are read to count it.

`--no-toc` skips this stage entirely.

### Counting a list longer than one window

A list of 94 perks over 16 pages does not fit one call, so each window is
counted on its own and the parts are added up, reported as they land:

```console
  yes  0.96   1.1s jev  Gadgets p.1 (window 1/3)
    + 10 (p=1.00)  p.1  running 10
    + 10 (p=0.95)  p.2  running 20
    + 10 (p=0.94)  p.3  running 30
  take  30 (p=0.94)  Gadgets p.1
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
contain, so Heart's class list gated at 0.32 for "Is knight a class?" and at
0.76 once asked whether it settles the claim, by stating it, contradicting it,
or naming the things of its kind.

A count also changes what a window has to satisfy to be worth reading. No page
says "there are 94 perks", so asking whether a window "contains the answer"
rejects the very pages the perks are listed on; a count asks whether the window
lists entries of the kind in question instead.

### Counts and statements keep looking

A section can plainly be about skills while the count inside it comes back at
`p=0.32`. So for count and truth questions the extracted answer must clear
`--answer-floor` (default 0.7) too; below it, the walk continues:

```console
  yes  0.93   0.6s jev  Chapter II: Perks p.2
  keep  3 (p=0.98)  Chapter II: Perks p.2      ← answer below floor, keep walking
  no   0.49   0.2s jev  Chapter I: Skills p.1
jevsec: no answer reached p=0.99 in 1 windows; best follows
3  (p=0.98, below 0.99)  manual.pdf p.2  Chapter II: Perks  (found p=0.93)
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
| `section` / `file` / `total` | elapsed time for that scope |

## Where the time goes

Every span splits into `jev` (inference), `read` (mutool/pdftotext), `stdin`
(waiting on whatever is feeding the pipe) and `other`. That split exists because
this is I/O bound, not inference bound:

```
total 105.4s (jev 3.3s, read 15.9s, stdin 86.2s, other 0.0s)
```

86 seconds of that was `find` walking a spinning disk before the first call went
out. `plocate` reads an index instead and makes it disappear.

## PDFs without an outline

There is nothing to rank, so the document is cut into page windows and read in
page order. Ranking those windows by their opening text was tried and removed:
a 300-character snippet put a credits page above the body, and since the walk
stops at the first yes, order only costs latency.

## Tables

Text is extracted with `pdftotext -layout`, which keeps a table row on one line
and two prose columns side by side. In reading order the columns came out
interleaved line by line and each table cell on a line of its own, three lines
from its label. A figure's choice now carries its row: "5, as in: Combat Rifle
5C …", and on the Fallout weapons table the cost and weight of a combat rifle
went from p=0.59 to p=1.00, the damage rating from unanswered to 5 at p=0.95.
A figure may carry a unit on its tail (`5CD`, `10mm`) but never a letter on its
head (`v2.5`, `p12`). A figure on several rows is offered once per row, up to
three, since the `5` in the header and the `5` in the Combat Rifle row are told
apart only by their rows and jev cannot pick a row it was never shown.

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
`noul` per call. A window is tagged with its first page, so a hit in a 16-page
section then links to where the section starts; at `--chars 12000` a 28-page
PDF becomes 6 windows and a hit lands on page 10 rather than page 1. It costs
the same calls and is less sharp, so it is only there for comparison.

## Limits

- **A count from the contents trusts the contents.** A section listing three of
  its four classes yields three, with no page read to check. Membership has a
  safeguard for this, a negative being confirmed against the pages; a count has
  none.
- **Counting is only as good as the scraps.** A name over four words or 60
  characters, one not starting with a capital, or one split across a line
  break is never offered, so it is never counted. Measured against the
  choice-over-numbers method it replaced, on two-column rulebooks. Fallout:
  the 94 perks over 16 pages came back as 95 at p=0.80 (a stray "GUNS" off
  an illustration counted; Dogmeat's perk and his stat block are one name,
  so he counts once; the old method said 80 at p=0.36); the 17 skills as 17 at p=1.00 (old 16);
  the 6 origins over 7 pages as 6 at p=0.32 (old 12). Legend in the Mist:
  the 20 theme types on one page as 19 at p=0.89 (old refused); the 153 theme
  kits over two pages as 94, the first page right (94 counted, 91 there,
  three of them headers) and the second refused at p=0.28 (old 17 at
  p=0.05); the 30 tropes over ten pages, three a page, refused at p=0.22
  with pages counted between 3 and 9, the kits listed under each trope being
  mistaken for tropes (old 23 at p=0.20). Refusing is the usual outcome on a
  page it cannot read, not a wrong number.
- **The category matcher is loose.** It takes any section whose name appears in
  the question, so "Is Brotherhood Initiate an origin?" can match a section
  named `Brotherhood`. A wrong match now costs a page read rather than a wrong
  answer, but it still costs one.
- **Filenames carry no signal sometimes.** `RTG-CPRed-SingleShotPackv1.1.pdf` is
  the Cyberpunk Red starter set; no question about netrunning will rank it
  above the file floor. The floors are soft: files and sections under them are
  read, in rank order, only while nothing has answered, so such a book is still
  reached within `--max-files` and `--max`. Above the floor `-n` windows are
  collected; below it one is enough. It just costs the reads above it
  first.
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
| live test suite | 34s, 121/126 | 12s, 126/126 |

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
```

The live tests are gated behind `JEV_LIVE=1` and assert only the direction of an
answer, never an exact probability. Fixtures are generated PDFs with their
`groff` sources in `fixture/`; rebuild them with `bun run fixture:build`.

## Layout

| file | role |
| --- | --- |
| `jevgrep.ts` | rank names from stdin |
| `jevsec.ts` | search one PDF |
| `jevfind.ts` | rank paths, then search them |
| `pdf.ts` | outline, page windows, the walk, links |
| `layout.ts` | a page's lines, columns, paragraphs and weights, for passages |
| `answer.ts` | classify the question, read counts and true/false |
| `shared.ts` | client, key, scoring rubric, timing |
| `format.ts` | column alignment and path elision |
| `outline.js` | mutool script printing `path<TAB>start<TAB>end` |

## Highlighting the answer

`--highlight` links to a copy of the PDF, in `~/.cache/jev/`, with the
passage's lines marked by a highlight annotation on its page, so the link
lands on the answer rather than the page. Any viewer that draws annotations
shows it. The copy is made afresh each run, since a highlight saved into it
stays there, and every hit in the same file adds its own; the Fallout
rulebook's 248 MB take about a second to copy. `--open` opens the copy. A
count, number or statement links to the page as before.

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
