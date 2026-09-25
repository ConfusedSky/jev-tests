# jev

Search a shelf of PDFs by asking a question instead of grepping for a string.

Three tools built on [jev](https://openrouter.ai/~typesafe/jev-latest), a
decision model that returns calibrated probabilities rather than text. It never
writes prose, so nothing here summarizes or paraphrases: every answer is a
number, a true/false, a passage or table of the book's own text, or a page to go
read.

```console
$ plocate '*.pdf' | bun jevfind.ts "How does hero creation work in Legend in the Mist?"
…
(p=0.91)  Legend-in-the-Mist-Core-Book.pdf p.73  … > Hero Creation  (found p=0.96)

  HERO CREATION

  You can create any hero you can dream of, by describing them with tags.
  …
```

The link is clickable and opens at the page; the passage is the page's own text.

## Setup

```sh
bun install
echo 'OPENROUTER_API_KEY=sk-or-v1-...' > .env
bun run tables:install          # pdfplumber, for reading tables (optional)
ollama pull qwen3-embedding:4b  # page embeddings and the ranking cache
ollama serve
```

Needs `mutool` (mupdf), `pdftotext` (poppler) and `rg` (ripgrep) on `PATH`.
The key is read from the environment or from `.env` next to the scripts, so
the tools work from any directory.

Ollama runs the embedding model that picks which of a long book's sections
jev ranks, and matches a question to earlier ones whose ranking it can reuse
(the ranking cache). Without them every book is ranked afresh, which costs
money, so a tool whose cache can't run stops before spending anything and
says what to do: start Ollama, or pass `--cache off`. The first question on
a book embeds its pages once, which takes a few minutes.

## The tools

| tool | answers | example |
| --- | --- | --- |
| `jevgrep` | which filenames could answer this? (names only, one call) | `ls fixture \| bun jevgrep.ts "What are the skills in the fallout rpg?"` |
| `jevsec` | which page of this PDF answers it? | `bun jevsec.ts book.pdf "How do I create a hero?"` |
| `jevfind` | which page of which PDF answers it? | `ls *.pdf \| bun jevfind.ts "How is radiation treated?"` |

Each prints its progress to stderr and the answer to stdout; `--help` lists
the flags. The link opens a copy of the PDF with the answer highlighted
(`--no-highlight` links to the PDF itself). Commonly used: `--open`, `-n N`
(several passages), `--kind K` (force a kind of question), `--tsv` (tables
as tab-separated rows), `--cache MODEL|off`.

## Kinds of question

jev reads the kind from the question's wording, and the answer's shape
follows.

| question | kind | output |
| --- | --- | --- |
| "How many classes are there in heart?" | count | `9  (p=1.00)` + link |
| "How much does the Umber cost?" | number | `80  (p=1.00)` + link |
| "Legend in the Mist uses a d20 for every roll." | truth | `false  (p=0.98)` + link |
| "How do I create a hero?" | passage | link + the sentences that answer |
| "How much does each type of magazine cost?" | passage | link + the table rows that answer |
| "Make a table of every small gun with its cost and weight" | table | link + a table built to the question |
| "Give me a table with Heart and Fallout as rows and ask how many skills are there" (`jevfind`) | table across the shelf | a table with a cell per row and question, and where each cell was read |

A table to order takes its rows from one table, each column from wherever
the book gives it (the rows' table, another table, each row's own entry, or
the row's own cells), and can add a value beside each item of a column:

```console
$ bun jevsec.ts fallout.pdf "Show me a table of the small guns with columns Damage and Barrel Mods. For each Mod column add the cost of the mod in parenthesis."
  SMALL GUN      Damage  Barrel Mods
  .44 Pistol     6 CD    Snubnose Barrel (–), Bull Barrel (+10)
  Assault Rifle  5 CD    Long Barrel (+20), Ported Barrel (+35), Vented Barrel (+36)
  …
```

## More

| document | covers |
| --- | --- |
| [docs/searching.md](docs/searching.md) | ranking a book, the ranking cache, the text search, the walk, reading the log, where the time goes |
| [docs/answers.md](docs/answers.md) | each kind of question in detail, answering from the contents, counting long lists, limits |
| [docs/tables.md](docs/tables.md) | reading tables, tables as records, tables to order, tables across the shelf |
| [docs/pages.md](docs/pages.md) | page layout, highlighting, links that open at the page |
| [docs/semif.md](docs/semif.md) | the optional local open-model backend |
| [docs/README.md](docs/README.md) | what the experiments measured, and what was tried and dropped |

## Files

| file | role |
| --- | --- |
| `jevgrep.ts` | rank names from stdin |
| `jevsec.ts` | search one PDF |
| `jevfind.ts` | rank paths, then search them |
| `cli.ts` | flags, the answer layer, printing |
| `pdf.ts` | outline, the text cache, ranking, the walk, links, highlighting |
| `search.ts` | search terms and the pages that mention them |
| `answer.ts` | read the question; count, figure, statement, passage |
| `compose.ts` | tables to order |
| `shelf.ts` | ranking and walking many paths; tables across the shelf |
| `cache.ts` | the ranking cache |
| `embed.ts` | page embeddings |
| `layout.ts` | a page's lines, columns, paragraphs, tables and weights |
| `tables.py` | pdfplumber script printing a page's tables as JSON |
| `shared.ts` | client, token counts, the ranking call, timing |
| `format.ts` | column alignment and path elision |
| `bench.ts` | the benchmark over real rulebooks |
| `outline.js`, `highlight.js` | mutool scripts: the outline, the highlight |
| `experiments/` | one-off measurement scripts behind `docs/` |

Tests and the benchmark are described in `CLAUDE.md`; `bun test` is offline
and free.
