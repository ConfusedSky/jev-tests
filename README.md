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
come back with a probability per option rather than a sentence.

Two probabilities print, and they mean different things: the answer's own
confidence, and `found p=…` for the window that produced it. Finding the right
pages and reading a value out of them fail independently.

Force a kind with `--kind count|truth|passage`.

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

`--chars` matters more here than anywhere else. The default 48000 turns a
28-page PDF into 2 windows, so a hit links to page 1; at `--chars 12000` it
becomes 6 windows and lands on page 10.

## Limits

- **A count comes from one window.** If a list straddles a window boundary, jev
  counts what it can see. There is no cross-window aggregation.
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
