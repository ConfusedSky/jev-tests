# How a book is searched

How the tools find the page that answers: ranking a book's sections, the
ranking cache, the text search, the walk, and reading the log. For how an
answer is read off the page once found, see [answers.md](answers.md).

## A shelf search, end to end

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

## jevgrep — which filenames could answer this?

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

## jevsec — which page of this PDF answers it?

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

An outline of more than 200 sections is not ranked whole: ranking costs a
jev question per section, and all 1058 of Fallout's were most of a
question's tokens. Every page of the book is embedded once
(Qwen3-Embedding-4B through Ollama, kept in `~/.cache/jev/embeddings/`;
the first question on a book says so and takes a few minutes), and jev
ranks only the sections holding one of the 20 pages most like the question
or one of the text search's pages:

```
ranked 99 of 1058 sections and 20 excerpts in 11.1s (…; 14,470 tokens in, …)
```

"How is radiation treated?" costs 27,958 tokens so, against 51,661 with
the outline ranked coarse to fine, which is what happens without Ollama:
the top two levels and the excerpts first, then only the sections under
the best eight of those levels. A shorter outline, or one the contents
already confine, is ranked whole. docs/token-usage.md has the measurements.

## The ranking cache

A ranking a walk answered from is kept per book in `~/.cache/jev/rankings/`,
and a later question close enough to it walks it instead of ranking again:

```
ranked from cache in 3.8s (…): "How is radiation treated?" (question 0.53, subject 0.85)
total 6.3s (…; 14,022 tokens in, …)          ← 54,681 when it ranked afresh
```

Closeness is an embedding model's, chosen with `--cache`: `qwen3-4b` (the
default, through a local Ollama), `qwen3-0.6b` (Ollama) or `3-small`
(OpenRouter). A cached question is close enough when its question and
its three best sections score at least a model's bar against the new
question, or its subject against the new subject (0.53 or 0.80 for
qwen3-4b); docs/ranking-cache.md has how the models and bars were chosen.
Each model keeps its own embeddings beside the rankings, which are shared.
A ranking the contents confined, or one whose walk found no answer, is not
kept.

Without the cache every book is ranked afresh, which costs money, so a
cache that cannot run stops the tool before anything is spent: start
Ollama (`ollama serve`; `ollama pull qwen3-embedding:4b` once), or pass
`--cache off`. The bench ranks afresh unless given `--cache MODEL`.

`-n, --hits N` keeps walking until N passages have passed the threshold and
prints them all, best first within a section. Passage questions only: a
count, number or statement has one answer.

## jevfind — which page of which PDF answers it?

The whole cascade: rank the paths by name and by the pages in them that
mention the subject, then rank each file's sections the same way, then read.
Stops at the first confident answer anywhere.

```sh
ls *.pdf | bun jevfind.ts "How is radiation treated?"
plocate '*.pdf' | bun jevfind.ts "How many perks can a character take?"
```

Prefer `plocate` to `find` on a spinning disk — see [Where the time
goes](#where-the-time-goes).

## Searching the text

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

## PDFs without an outline

There are no titles to rank, so the pages the text search found are ranked
and read first, and the rest of the document is cut into page windows and
read in page order, `--max` of them: a shelf search opened two 400-page
books on a page each and then read every page of both, seven minutes for
no answer. Raise `--max` to read a whole book. Ranking those windows by
their opening text was tried and removed: a 300-character snippet put a
credits page above the body, and since the walk stops at the first yes,
order only costs latency.

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

A table to order logs each of its steps the same way: reading the request,
finding the rows, the columns their table holds, the entries, the column
searches, filling the cells and looking up what goes beside each item. A
step with lines of its own names itself first (`rows: finding the table of
small guns…`), its lines stand indented under it, and its sum comes after
them, so an indented line is part of the sum below it, never added to it;
the unindented sums add up to the total. Sections read the same way. The
column searches run one at a time so each one's lines sum only its own
calls; the lookups of several columns run side by side and are one line.

## Where the time goes

Every span splits into `jev` (inference), `read` (mutool/pdftotext), `stdin`
(waiting on whatever is feeding the pipe) and `other`, with `embed` (the
ranking cache's embeddings), `highlight` (copying the book to mark the
answer) and `sizes` (reading the marked pages' sizes for `--json`) named
when they took any time; the total counts the last two, which come after the
walk. That split exists because this is I/O bound, not inference bound:

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
