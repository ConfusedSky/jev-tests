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
| `sizes.js` | mutool script printing each page's width and height |
| `docs/` | what experiments measured, what was adopted, what was tried and dropped |
| `experiments/` | the one-off scripts and data behind `docs/` |

## Highlighting the answer

The link goes to a copy of the PDF, in `~/.cache/jev/` under a name
that carries a hash of the path so two shelves' `manual.pdf` stay apart, with the
passage's lines marked by a highlight annotation on its page, so the link
lands on the answer rather than the page. Any viewer that draws annotations
shows it. The copy is made afresh each run, since a highlight saved into it
stays there, and every hit in the same file adds its own; the Fallout
rulebook's 248 MB take about a second to copy. `--open` opens the copy.
`--no-highlight` links to the PDF itself and makes no copy.

A value is marked where it stands. A count marks each name it counted, on
every page it counted from: Heart's nine skills, Cyberpunk Red's skill
names without their leaders and stat. A number marks the figure jev
picked: in a table the cell under its column's head, the Combat Rifle's
damage 5, weight 11 and cost 117, and in prose the line holding it. Each
name or figure is marked by its own characters' edges, as mutool reports
them. These are not marked, and link to their page as before:
- a statement, which rests on no single line;
- a count read off the contents;
- a count or figure whose text was not found on the page's lines.

Two runs at once on one book write the same copy, and each run's fresh copy
wipes the other's marks.

## The highlight as data

`--json` reports what the copy would highlight, whether or not one is made.
Each hit carries `marks`, the boxes of a passage's lines (a table's cells
included) or of the names a count counted and the figure a number picked,
each box once, and `pages`, the size of each page they fall on:

```json
"marks": [{ "page": 1, "x0": 234.68, "y0": 225.1, "x1": 266.62, "y1": 239.1 }],
"pages": { "1": { "width": 595, "height": 842 } }
```

Both are in PDF points from the page's top left, where stext puts a line and
`mutool draw` lays out the page (`sizes.js` reads the sizes), so a box
scales onto the page drawn at any width by that width over the page's. A
statement has none. The best answer under the floor has its marks, and so
does every cell of a table across the shelf.

The web UI runs the tools with `--no-highlight` and draws each run's marks
over the pages itself, so an older run keeps its own highlight and no book
is copied to show one. A marked copy is made only to open a page in a
desktop viewer, from the marks the run kept.

A table's row is marked a cell at a time, so a passage that keeps only the
asked columns marks only those cells: the weapon and its damage, not its
magazine and cost.

```sh
bun jevsec.ts --open book.pdf "What skills are there?"
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
