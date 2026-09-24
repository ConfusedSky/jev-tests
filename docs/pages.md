# Pages: layout, highlighting and links

How a page's text is laid out for reading, how the answer is marked in a
copy of the PDF, and how the link opens at the page.

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
| `docs/` | what experiments measured, what was adopted, what was tried and dropped |
| `experiments/` | the one-off scripts and data behind `docs/` |

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
