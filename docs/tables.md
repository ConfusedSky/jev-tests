# Tables

How tables are found and read (pdfplumber), printed as records, and built
to a question's own design.

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
   cells fill for at least half the rows is not searched for.
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
