# jev

Search a shelf of PDFs by asking a question instead of grepping for a string.

Three tools, built on [jev](https://openrouter.ai/~typesafe/jev-latest), a
decision model that returns calibrated probabilities rather than text. It never
writes prose, so nothing here summarizes or paraphrases: every answer is a
number, a true/false, or a page to go read.

```console
$ ls *.pdf | bun jevfind.ts "How does hero creation work in Legend in the Mist?"
ranked 52 paths in 0.4s (jev 0.4s, read 0.0s, other 0.0s), 1 above file floor 1.5 (51 skipped)
2.91  Legend-in-the-Mist-Core-Book.pdf
  ranked 169 sections in 0.5s (jev 0.5s, read 0.0s, other 0.0s), 12 above title floor 1
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
ranked 169 sections in 0.5s, 12 above title floor 1 (157 skipped)
  yes  0.97   0.3s jev  … > Hero Creation p.73
book.pdf p.73  … > Hero Creation  (found p=0.97)
```

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
| "Legend in the Mist uses a d20 for every roll." | truth | `false  (p=0.99)` + link |
| "How do I create a hero?" | passage | link only |

Because jev emits no text, a count is a `choice` over the numbers themselves
(`0`…`N`, plus `over N` and `not stated`), and a statement is a `noul`. Both
come back with a probability per option rather than a sentence. `N` is
`--count-max` (default 50); an `over N` answer is asked once more with the full
range of 252, so a low ceiling costs a call rather than the answer. `not stated`
is a refusal, not an answer: the window is dropped and the walk goes on.

Two probabilities print, and they mean different things: the answer's own
confidence, and `found p=…` for the window that produced it. Finding the right
pages and reading a value out of them fail independently.

Force a kind with `--kind count|truth|passage`.

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

Counting bookmarks only holds while they are a list. Past `--toc-max-span`
pages (default 3) a section is a set of chapters instead, and the contents are
abandoned for the pages: the Fallout rulebook nests 89 of its 94 perks under
the first perk, so counting any one section's entries there gives 7 or 89,
never 94.

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
"Is heretic a calling?" with true:

```console
Is witch a class in heart?    true  (p=1.00)   contents, no page opened
Is knight a class in heart?   false (p=0.97)   contents said no, Classes pages agreed
Is heretic a calling?         false (p=0.96)   contents said no, Callings pages agreed
```

A count whose section spans more than `--toc-max-span` pages is confined the
same way: the contents say which section holds the list, and the pages of that
section are read to count it.

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
dropped as a fragment of the same list rather than kept as a fallback.

The aggregate is only as trustworthy as its least certain contributing part, so
that is the confidence reported. A window listing none of the items neither
adds nor lowers it, since a long section is expected to have some.

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
  none beyond the `--toc-max-span` limit.
- **Counting dense pages is unreliable.** Summing windows is exact on a clean
  list (30 gadgets over three windows, p=0.94) and poor on a two-column
  rulebook: the Fallout perks come back as 64 of 94, at p=0.07. The floor
  refuses that rather than reporting it, so the usual outcome there is no
  answer rather than a wrong one.
- **The category matcher is loose.** It takes any section whose name appears in
  the question, so "Is Brotherhood Initiate an origin?" can match a section
  named `Brotherhood`. A wrong match now costs a page read rather than a wrong
  answer, but it still costs one.
- **Filenames carry no signal sometimes.** `RTG-CPRed-SingleShotPackv1.1.pdf` is
  the Cyberpunk Red starter set; no question about netrunning will rank it.
  Lower `--file-floor`, or search it directly with jevsec.
- **Scanned PDFs are invisible.** Extraction is text-only; no OCR.
- **`--count-max` above 252 is clamped**, because a `choice` takes at most 255
  options and two are spent on `over N` and `not stated`.
- **Probabilities move between runs.** jev is not deterministic at the margins,
  so a borderline window can flip either side of a threshold.

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
| `answer.ts` | classify the question, read counts and true/false |
| `shared.ts` | client, key, scoring rubric, timing |
| `format.ts` | column alignment and path elision |
| `outline.js` | mutool script printing `path<TAB>start<TAB>end` |

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
