# Tables

How tables are found and read (pdfplumber), printed as records, built
to a question's own design, and built across the shelf.

Tables are read with pdfplumber: `bun run tables:install` puts it in `.venv`
with uv; without it, tables are read as text and the log says so once.

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
   pages after the table (`ENTRY_PAGES` of them): the paragraphs under a
   heading that is the row's name
   (".44 PISTOL"). jev picks, once per column, the label the entries give
   it under ("Ammunition" for ammo type), and each entry's line with that
   label is the row's value, so every row reads the same line.
4. A column still missing is read from each row's own cells, a choice
   among their pieces: "M Pistol" out of "12 (M Pistol)". A column the
   cells fill for at least half the rows (and at least two) is not
   searched for: the cells are trusted over a table no search looked for,
   and rows they leave empty stay N/A.
5. Each column still missing gets a search of its own, collecting up to
   three passages; every table those find is offered for every missing
   column, since the extended sizes' search may find the drum sizes too.
6. Another table's rows are matched to ours by name, then by asking jev for
   the rest; a row the table lacks keeps what its own cells gave.
7. Any cell still empty, a row without an entry, is read from the row's own
   cells. None is N/A.

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

A request can keep the book's own columns and add to them: "Show me the
standard weapon table. In addition to the normal columns add the extended
magazine size" reads `keep` in the same call that reads the words, and the
rows' table's columns (those some row fills) go before the named ones; a
named column the table already holds is not repeated.

When the rows' passage holds several tables, jev picks the one the question
asks for, with a row for each of the things as the question names them: the
rows' name alone loses "standard" in some readings, and CPR's p.95 passage
runs on to the exotic weapons; a heading or prose between two tables with the
same heads keeps them apart.

Measured with `experiments/compose/` on 2026-09-25: `keep` read true 6 of
6 times on the request above and 3 of 3 on "with all its columns", false
12 of 12 on four requests that name every column. The prompt's example is
the request above, so the last two are the evidence it generalises. Asked
"which table has a row for each of the weapon", jev took the exotic table
10 of 10 times, and 5 of 5 with "standard weapon" when the exotic table
was offered first; asked for the table the question asks for, it took the
standard one 20 of 20 times. The bench showed no case falling.

The table prints, pipes and highlights as a passage's rows do, each cell
marked on the page it came from. A table request that names no columns
("show me the exotic weapons table") wants the book's own and is read as a
passage. Piped, a row is a line of JSON; `--tsv` prints heads and rows
tab-separated, for a built table and a passage's table alike, with the link
on stderr so stdout is the table alone. A table found but with no column
for any row is not an answer: it prints as the best found and exits 1. Most of a
table's time and tokens go to the column searches it still needs.

## Tables across the shelf

`jevfind` builds a table whose rows are documents the question names and
whose columns are questions asked of each:

```
$ ls *.pdf | bun jevfind.ts "Give me a table with Heart, Fallout and Cyberpunk Red as rows and ask how many skills are there for each row?"

  name           how many skills are there
  Heart          9
  Fallout        17
  Cyberpunk Red  62

(p=1.00)  Heart, how many skills are there: heart-….pdf p.12  How To Play > Skills, Domains and Knacks  (found p=0.87)
…
```

1. A table question gets one more call. It asks whether the rows are documents
   on the shelf rather than things inside one, and it reads word by word
   which words name the rows and which ask the columns' questions.
   - The table is built across the shelf when jev gives the first question 0.5
     or more and at least one row and one column were read.
   - `--across` skips the question's own reading and builds it across without
     asking. `--no-across` never asks and builds from one document, as before.
2. Each cell's question is its column's question put of its row, "how many
   skills are there in Heart?". The cell question is read and walked as a
   question of its own, over every path on stdin:
   - A value (count, number, truth) fills the cell.
   - A passage fills it with where it stands ("p.36 Healing"), and the passage
     prints under the cell's source line.
   - A cell question read as a table is walked as a passage.
   - Each cell's link opens a copy of its book with the counted names, the
     figure or the passage marked (see [pages.md](pages.md)).
3. A cell opens only files whose names clear `--file-floor`, and no page
   excerpts are ranked. The row names its document, so a file that does not
   match the name is another work, and its answer would stand in the wrong
   row. Two files of one work (a core book and a supplement) can both clear
   the floor and both be read.
4. A cell nothing answered is N/A. Its source line says why:
   - the best answer below the answer floor,
   - no file name reaching the file floor, or
   - how many files were opened without an answer.

Cells run one after another. Each cell prints a header, its reading, its
path ranking and its walk under it, then its sum, so the sums add up to
`total`. A cell costs about what the same question asked of one book costs.
The example cost 310,678 tokens ($0.013): 27k for Heart, 77k for Fallout
and 197k for Cyberpunk Red, with the rest on reading the request.

Rows must be named. A row for every document of some kind on the shelf needs
the catalogue of issue #12. A column must be a whole question:
- "how many skills and how many classes" reads as two columns.
- "how many skills and classes are there" reads as "how many skills" and
  "classes are there".

**Reading the rows, measured.** Scripts: `experiments/across/read.ts` and
`rows.ts`.
- **Detection.** The "rows are documents" noul gave 0.85–0.91 on three
  requests that name documents as rows, and 0.14–0.33 on two table requests
  from one book.
- **Row words.**
  - jev rates a title's own words under even odds at times: over six
    readings of "Legend in the Mist", Legend got 0.36–0.49, in 0.77–0.89,
    the 0.41–0.49 (0.27 in another request) and Mist 0.47–0.54.
  - The words around the titles ("and", "with", "a") stay at 0.06 or less.
  - So a row is a run of words at 0.2 or more, trimmed of joining words at
    its ends. It read all three rows in six of six readings.
  - Dropped: a bar of 0.8 for joining words and 0.5 for others. It lost
    "Legend in the Mist" in two of six.
- **Column words.**
  - A question's own words scored 0.62–0.93, "are" and "does" included.
  - The words beside them scored at most 0.39 ("and" between two questions,
    "for each row").
  - So a column is a run of words at 0.5 or more.
- **Cell wording.** "how many skills are there in Heart?" and "In Heart, how
  many skills are there?" read the same kind every time. The first form is
  kept: "healing work in Fallout?" read as a passage, but "In Fallout,
  healing work?" read as a truth.
