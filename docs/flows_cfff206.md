# Flowcharts at cfff206

How each tool decides what to read and what to answer, with every call to jev marked. Thresholds are the defaults in `cli.ts` and `shelf.ts`. How each step works and why is in [searching.md](searching.md), [answers.md](answers.md) and [tables.md](tables.md); these charts are drawn from the code at commit cfff206 and are not kept up to date with it, so check a step against the code before relying on its chart.

## Overview

The three tools and the walk they share. Blue boxes are jev calls, numbered as in the table below; amber are decisions; green an answer; red an exit with none; purple a step with a chart of its own.

```mermaid
flowchart TD
  subgraph G["jevgrep: names only"]
    G1["filenames on stdin"] --> G2[["J1 rank names"]] --> G3["names ≥ 1.5"]
  end
  subgraph S["jevsec: one PDF"]
    S1["PDF + question"] --> S2[["answer layer: J2"]] --> S3{{"table?"}}
    S3 -- yes --> S4["compose a table<br/>J11–J17 + walks"]
    S3 -- no --> S5["walk the PDF"]
  end
  subgraph F["jevfind: many PDFs"]
    F1["paths on stdin"] --> F2[["answer layer: J2<br/>(J3 if a table)"]] --> F3{{"rows are documents?"}}
    F3 -- yes --> F4["table across the shelf:<br/>a full jevfind per cell"]
    F3 -- no --> F5[["J1 rank files<br/>(names + excerpts)"]] --> F6["per file, best first:<br/>walk or compose"]
  end
  subgraph W["the walk (one PDF)"]
    W1[["contents check: J4 (count)"]] --> W2[["J1 rank sections + excerpts"]] --> W3[["J5 gate pages"]] --> W4[["read the answer by kind:<br/>count J6 · number J7 · truth J8 · passage J9, J10"]]
  end
  S5 --> W1
  F6 --> W1
  S4 --> W1
  class G2,S2,F2,F5,W1,W2,W3,W4 jev
  class S3,F3 dec
  class G3 ok
  class S4,S5,F4,F6 sub
  classDef jev fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#111827
  classDef dec fill:#fef3c7,stroke:#d97706,color:#111827
  classDef stop fill:#fee2e2,stroke:#dc2626,color:#111827
  classDef ok fill:#dcfce7,stroke:#16a34a,color:#111827
  classDef sub fill:#f3e8ff,stroke:#9333ea,stroke-dasharray:4 3,color:#111827
```

### Every jev call

| id | call | asks, in one request | where |
| --- | --- | --- | --- |
| J1 | rank (`rank`, shared.ts) | a `score` of 0–3 per item, 40 items per call, calls in parallel | filenames (jevgrep, jevfind); section titles and page excerpts (the walk) |
| J2 | read the question (`readQuestion`, answer.ts) | a `choice` of kind; a `noul` for a figure of each of several things; four `noul`s per word: quantity, counted kind, subject, game | every question, and every cell of a table across the shelf |
| J3 | read across (`readAcross`, shelf.ts) | a `noul` for rows that are documents; two `noul`s per word: row name, column question | jevfind |
| J4 | contents (`answerFromOutline`) | a `choice` of the section whose children are the things counted; a `noul` per section for children that are groups | count |
| J5 | gate (`askPages`, `askWindow`, pdf.ts) | a `noul` per page: contains the answer, lists entries of the kind, or truth's three; pages batched to `--chars` | every section and excerpt the walk reads |
| J6 | count (`rawCount`) | a `noul` per candidate name, at most 150 per call | count |
| J7 | figure (`numberFrom`) | a `choice` per quantity among the page's figures and "not stated" | number |
| J8 | claim (`growList`) | the three truth `noul`s on a neighbouring page | truth, when a list says false |
| J9 | sentences (`readPassage`) | a `noul` per sentence or table row, at most 150 per call | passage; table rows |
| J10 | columns (`columnsFor`) | a `choice` per table and quantity: the column holding it | passage naming quantities; placing a table's columns |
| J11 | request (`readRequest`, compose.ts) | a `noul` for keeping the table's own columns; three `noul`s per word: row thing, column, what to add | table |
| J12 | annotated columns (`readRequest`) | a `noul` per column for adding the value beside its items | table, when something is added |
| J13 | table (`pickTable`) | a `choice` of the table with a row per thing | table, when a passage holds several |
| J14 | labels (`labelsFor`) | a `choice` per column among the labels of the rows' entries | table |
| J15 | own cells (`deriveCells`) | a `choice` per row and column among pieces of the row's cells | table |
| J16 | rows (`matchRows`) | a `choice` per unmatched row among the other table's rows | table |
| J17 | values (`annotate`) | a `choice` per nearby table of the column giving the value; a `choice` of row group | table, when something is added |

## jevgrep

Ranks filenames from stdin, one call per 40 names. Never opens a file.

```mermaid
flowchart TD
  A["stdin: one filename per line"] --> B{{"any names?"}}
  B -- no --> X["exit 2"]
  B -- yes --> J1[["J1 rank: score each name 0–3<br/>against the question, 40 per call"]]
  J1 --> F{{"score ≥ -t threshold<br/>(default 1.5)?"}}
  F -- no --> D["dropped"]
  F -- yes --> T["keep best -n N"] --> E{{"any left?"}}
  E -- yes --> O["print name, score, reason<br/>(-l names only, --json)"] --> E0["exit 0"]
  E -- no --> E1["exit 1"]
  class J1 jev
  class B,F,E dec
  class X,E1,D stop
  class O,E0 ok
  classDef jev fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#111827
  classDef dec fill:#fef3c7,stroke:#d97706,color:#111827
  classDef stop fill:#fee2e2,stroke:#dc2626,color:#111827
  classDef ok fill:#dcfce7,stroke:#16a34a,color:#111827
  classDef sub fill:#f3e8ff,stroke:#9333ea,stroke-dasharray:4 3,color:#111827
```

## jevsec

One PDF: read the question, walk the book or compose a table, report.

```mermaid
flowchart TD
  A["book.pdf + question"] --> V{{"file exists, not empty,<br/>mutool can open it?"}}
  V -- no --> X["exit 2"]
  V -- yes --> CC{{"--cache MODEL set and<br/>Ollama / model not ready?"}}
  CC -- yes --> X
  CC -- no --> AL["Answer layer<br/>J2 read the question → kind"]
  AL --> K{{"kind?"}}
  K -- table --> CT["Compose a table<br/>(table chart)"]
  K -- "count · number · truth · passage" --> SP["Walk the PDF<br/>(walk chart)"]
  CT --> R{{"outcome?"}}
  SP --> R
  R -- "answer taken" --> H["highlighted copy of PDF,<br/>print value / passage + link<br/>--open opens at page"] --> E0["exit 0"]
  R -- "answers read, all below<br/>--answer-floor 0.7" --> B1["print best, marked 'below'"] --> E1["exit 1"]
  R -- "pages passed gate<br/>but said 'not stated'" --> E1
  R -- "nothing passed gate" --> E1
  class AL jev
  class V,CC,K,R dec
  class X,E1 stop
  class H,E0,B1 ok
  class CT,SP sub
  classDef jev fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#111827
  classDef dec fill:#fef3c7,stroke:#d97706,color:#111827
  classDef stop fill:#fee2e2,stroke:#dc2626,color:#111827
  classDef ok fill:#dcfce7,stroke:#16a34a,color:#111827
  classDef sub fill:#f3e8ff,stroke:#9333ea,stroke-dasharray:4 3,color:#111827
```

## jevfind: across or one answer

Decides between a table across the shelf and one answer from the best file.

```mermaid
flowchart TD
  A["stdin: paths"] --> B{{"any paths?"}}
  B -- no --> X["exit 2"]
  B -- yes --> FA{{"--across?"}}
  FA -- yes --> J3a[["J3 read across: which documents<br/>are rows, which questions are columns"]]
  J3a --> NA{{"rows and columns both read?"}}
  NA -- no --> X1["exit 1"]
  NA -- yes --> ACR["Table across the shelf<br/>(across chart)"]
  FA -- no --> AL[["Answer layer:<br/>J2 read the question → kind"]]
  AL --> KT{{"kind = table and no --no-across?"}}
  KT -- yes --> J3b[["J3 read across"]]
  J3b --> PA{{"p ≥ 0.5 rows name documents,<br/>rows + columns read?"}}
  PA -- yes --> ACR
  PA -- no --> FI["findIn: rank the shelf, walk files<br/>(next chart)"]
  KT -- no --> FI
  ACR --> RA["print grid + where each cell was read"]
  FI --> REP["report (as jevsec)"]
  class J3a,J3b,AL jev
  class B,FA,NA,KT,PA dec
  class X,X1 stop
  class REP,RA ok
  class ACR,FI sub
  classDef jev fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#111827
  classDef dec fill:#fef3c7,stroke:#d97706,color:#111827
  classDef stop fill:#fee2e2,stroke:#dc2626,color:#111827
  classDef ok fill:#dcfce7,stroke:#16a34a,color:#111827
  classDef sub fill:#f3e8ff,stroke:#9333ea,stroke-dasharray:4 3,color:#111827
```

## jevfind: ranking and opening files

`findIn` in shelf.ts: files ranked by name and by pages that mention the subject, then walked best-first.

```mermaid
flowchart TD
  EM["paths, empty files left out"] --> EX{{"subject terms read,<br/>kind not count, floor soft?"}}
  EX -- yes --> RG["pdftotext every PDF (cached);<br/>ripgrep ≤ 3 excerpts per file<br/>that mention the subject"]
  EX -- no --> J1
  RG --> J1[["J1 rank: filenames + excerpts, 0–3"]]
  J1 --> SC["file score = its name if ≥ --file-floor 1.5,<br/>else its best excerpt, capped just below floor"]
  SC --> TOP["best --max-files 5, best first"]
  TOP --> LOOP{{"next file below the file floor?"}}
  LOOP -- "yes, and an answer taken<br/>(or hard floor)" --> REP
  LOOP -- "no; or yes, nothing yet" --> OK{{"PDF, exists, mutool opens it?"}}
  OK -- no --> LOOP
  OK -- yes --> K{{"kind?"}}
  K -- table --> CT["Compose a table in this file<br/>(table charts)"]
  K -- other --> SP["Walk this PDF (walk charts)<br/>with the hit and fallback budget left"]
  CT --> ST{{"-n hits taken, or<br/>--max-answers fallbacks?"}}
  SP --> ST
  ST -- no --> LOOP
  ST -- yes --> REP["outcome → report"]
  class J1 jev
  class EX,LOOP,OK,K,ST dec
  class REP ok
  class CT,SP sub
  classDef jev fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#111827
  classDef dec fill:#fef3c7,stroke:#d97706,color:#111827
  classDef stop fill:#fee2e2,stroke:#dc2626,color:#111827
  classDef ok fill:#dcfce7,stroke:#16a34a,color:#111827
  classDef sub fill:#f3e8ff,stroke:#9333ea,stroke-dasharray:4 3,color:#111827
```

## A table across the shelf

Each cell is a question of its own, read (J2) and walked over the shelf under a hard file floor.

```mermaid
flowchart TD
  R["rows: documents named<br/>(e.g. Heart, Fallout)"] --> C["columns: questions<br/>(e.g. how many skills are there)"]
  C --> L["for each row × column, one after another"]
  L --> Q["cell question = '{column} in {row}?'"]
  Q --> J2[["J2 read the cell question → kind"]]
  J2 --> T{{"kind = table?"}}
  T -- yes --> P["read as passage"]
  T -- no --> F
  P --> F["findIn with a hard file floor:<br/>J1 rank names + excerpts,<br/>never open a file below 1.5"]
  F --> W["Walk best file(s)<br/>(walk chart + kind chart)"]
  W --> V{{"answered?"}}
  V -- yes --> CV["cell = value<br/>(passage: page + section title)"]
  V -- "below floor" --> CB["N/A, best value + why"]
  V -- no --> CN["N/A + why: no name reached floor /<br/>no readable PDF / none answered"]
  CV --> L
  CB --> L
  CN --> L
  class J2,F jev
  class T,V dec
  class CV ok
  class CB,CN stop
  class W sub
  classDef jev fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#111827
  classDef dec fill:#fef3c7,stroke:#d97706,color:#111827
  classDef stop fill:#fee2e2,stroke:#dc2626,color:#111827
  classDef ok fill:#dcfce7,stroke:#16a34a,color:#111827
  classDef sub fill:#f3e8ff,stroke:#9333ea,stroke-dasharray:4 3,color:#111827
```

## The answer layer

`answerLayer` in cli.ts. `--kind` replaces only the kind: the quantities, counted kind, subject and game still come from J2.

```mermaid
flowchart TD
  Q["question"] --> J2[["J2 read the question, one call:<br/>choice: kind (count · number · truth · passage · table)<br/>noul: 'a figure for each of several things?'<br/>per word, 4 nouls: quantity · counted kind · subject · game"]]
  J2 --> E{{"kind = number and<br/>'each' ≥ 0.3?"}}
  E -- yes --> PS["kind = passage<br/>(a table of figures answers it)"]
  E -- no --> KF{{"--kind given?"}}
  PS --> KF
  KF -- yes --> KO["--kind wins"]
  KF -- no --> K["jev's kind"]
  KO --> W
  K --> W["words → names: quantities ('cost', 'rate of fire'),<br/>counted ('theme kits'), subject ('combat rifle'), game"]
  W --> S{{"--no-search?"}}
  S -- no --> T["search terms: subject words,<br/>minus the game's name"]
  S -- yes --> G
  T --> G["choose per kind:<br/>gate · verifier · contents check"]
  G --> GT["count → gate 'lists entries of the kind'<br/>truth → gate 'stated · contradicts · lists kind'<br/>number · passage · table → gate 'contains the answer'"]
  class J2 jev
  class E,KF,S dec
  classDef jev fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#111827
  classDef dec fill:#fef3c7,stroke:#d97706,color:#111827
  classDef stop fill:#fee2e2,stroke:#dc2626,color:#111827
  classDef ok fill:#dcfce7,stroke:#16a34a,color:#111827
  classDef sub fill:#f3e8ff,stroke:#9333ea,stroke-dasharray:4 3,color:#111827
```

## The walk: contents and ranking

`searchPdf` in pdf.ts, up to the ranked list.

```mermaid
flowchart TD
  A["PDF"] --> O["outline (mutool) +<br/>text cache (pdftotext -layout)"]
  O --> TC{{"has outline, no --no-toc,<br/>kind count or truth?"}}
  TC -- yes --> TOC[["Contents check<br/>(count: J4 · truth: string match)"]]
  TOC -- "answers" --> DONE["hit from the contents, done"]
  TOC -- "names a section" --> CF["confine walk to that section<br/>+ its chapter's opening pages;<br/>title floor off"]
  TOC -- "nothing" --> CH
  TC -- no --> CH
  CF --> CH{{"--cache on, not confined,<br/>similar question cached?"}}
  CH -- yes --> CR["reuse cached ranking"]
  CH -- no --> EXQ{{"subject terms read,<br/>kind not count?"}}
  EXQ -- yes --> RG["ripgrep: page excerpts<br/>that mention the subject"]
  EXQ -- no --> SZ
  RG --> SZ{{"> 200 sections<br/>and not confined?"}}
  SZ -- no --> J1a[["J1 rank every section title + excerpts"]]
  SZ -- yes --> EMB{{"Ollama embeddings<br/>available?"}}
  EMB -- yes --> EP["20 pages most like the question<br/>→ sections holding them"] --> J1b[["J1 rank those sections + excerpts"]]
  EMB -- no --> J1c[["J1 rank top two outline levels + excerpts,<br/>then J1 rank sections under the best 8"]]
  J1a --> WK["ranked list → the walk"]
  J1b --> WK
  J1c --> WK
  CR --> WK
  class J1a,J1b,J1c,TOC jev
  class TC,CH,EXQ,SZ,EMB dec
  class DONE ok
  class WK sub
  classDef jev fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#111827
  classDef dec fill:#fef3c7,stroke:#d97706,color:#111827
  classDef stop fill:#fee2e2,stroke:#dc2626,color:#111827
  classDef ok fill:#dcfce7,stroke:#16a34a,color:#111827
  classDef sub fill:#f3e8ff,stroke:#9333ea,stroke-dasharray:4 3,color:#111827
```

## The walk: gating and settling

Pages gated in ranked order; a page that passes is read by its kind and taken, kept or dropped.

```mermaid
flowchart TD
  WK{{"next ranked item<br/>(≤ --max 12 sections)"}}
  WK -- "score < title floor 1.0<br/>and an answer taken" --> FIN
  WK -- section --> SK{{"pages already read, or<br/>under a counted section?"}}
  SK -- yes --> WK
  SK -- no --> J5[["J5 gate: one noul per page,<br/>pages batched to --chars 48000"]]
  WK -- excerpt --> J5e[["J5 gate: every excerpt page<br/>together, on the first one"]]
  J5 --> Y{{"page p ≥ -t 0.7?<br/>(best page first)"}}
  J5e --> Y
  Y -- no --> WK
  Y -- yes --> SET{{"count, and section<br/>spans > 1 page?"}}
  SET -- yes --> CA["count every page of the section<br/>(count chart)"]
  SET -- no --> VF["read the answer off the page<br/>(kind charts)"]
  CA --> VD{{"verdict"}}
  VF --> VD
  VD -- "take: p ≥ answer floor 0.7" --> NH{{"-n hits taken?"}}
  NH -- yes --> FIN
  NH -- no --> WK
  VD -- "keep: below floor" --> SP{{"5 kept (--max-answers)?"}}
  SP -- yes --> FIN
  SP -- no --> WK
  VD -- "drop: 'not stated'" --> WK
  WK -- "list ends" --> NO{{"no outline at all?"}}
  NO -- yes --> SCAN["read pages in order,<br/>--max windows, same gate"] --> FIN
  NO -- no --> FIN["outcome; ranking stored<br/>in cache if answered"]
  class J5,J5e jev
  class WK,SK,Y,SET,VD,NH,SP,NO dec
  class FIN ok
  class CA,VF sub
  classDef jev fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#111827
  classDef dec fill:#fef3c7,stroke:#d97706,color:#111827
  classDef stop fill:#fee2e2,stroke:#dc2626,color:#111827
  classDef ok fill:#dcfce7,stroke:#16a34a,color:#111827
  classDef sub fill:#f3e8ff,stroke:#9333ea,stroke-dasharray:4 3,color:#111827
```

## Count: from the contents

`answerFromOutline` in answer.ts, before any page is read.

```mermaid
flowchart TD
  O["outline parents with more than one child"] --> J4[["J4 one call:<br/>choice: which section's children are the things counted<br/>noul per section: are its children groups, not things?"]]
  J4 --> P{{"pick p ≥ answer floor 0.7?"}}
  P -- no --> PG["read pages, whole book"]
  P -- yes --> GR{{"children are groups, or the list<br/>is nested under one child?"}}
  GR -- yes --> CS["read that section's pages"]
  GR -- no --> SB{{"picked a lone child whose siblings<br/>are leaves, under a section about the kind?"}}
  SB -- yes --> CP["read the parent section's pages"]
  SB -- no --> AN["answer = number of children, done"]
  class J4 jev
  class P,GR,SB dec
  class AN ok
  classDef jev fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#111827
  classDef dec fill:#fef3c7,stroke:#d97706,color:#111827
  classDef stop fill:#fee2e2,stroke:#dc2626,color:#111827
  classDef ok fill:#dcfce7,stroke:#16a34a,color:#111827
  classDef sub fill:#f3e8ff,stroke:#9333ea,stroke-dasharray:4 3,color:#111827
```

## Count: from the pages

jev judges each candidate name; code counts.

```mermaid
flowchart TD
  G[["J5 gate: 'lists entries of the kind'"]] --> C{{"≥ 3 styled runs on the page?"}}
  C -- yes --> STY["candidates = names set in<br/>their own type style"]
  C -- no --> SCR["candidates = short capitalised<br/>scraps of the text"]
  STY --> J6[["J6 noul per candidate:<br/>'exactly the name of one {kind}?'<br/>≤ 150 per call, page text in state"]]
  SCR --> J6
  J6 --> Z{{"styled runs counted nothing?"}}
  Z -- yes --> J6b[["J6 again on the scraps"]]
  Z -- no --> CNT
  J6b --> CNT["yeses (≥ 0.5) in the most common style,<br/>names deduped → count<br/>p = sure ÷ (sure + doubtful)"]
  CNT --> MW{{"section spans many pages?"}}
  MW -- yes --> AC["every page counted (J6 each, in parallel),<br/>names unioned across pages,<br/>p = worst page × share of pages counted"]
  MW -- no --> R["count"]
  class G,J6,J6b jev
  class C,Z,MW dec
  class R,AC ok
  classDef jev fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#111827
  classDef dec fill:#fef3c7,stroke:#d97706,color:#111827
  classDef stop fill:#fee2e2,stroke:#dc2626,color:#111827
  classDef ok fill:#dcfce7,stroke:#16a34a,color:#111827
  classDef sub fill:#f3e8ff,stroke:#9333ea,stroke-dasharray:4 3,color:#111827
```

## Number

The answer is one of the figures printed on the page; jev picks which.

```mermaid
flowchart TD
  G[["J5 gate: 'contains the answer'"]] --> L["page as laid out:<br/>table rows as records"]
  L --> F["every figure on the page<br/>(digits or words), with its row as context;<br/>≤254, cut to fit jev's size limits"]
  F --> N{{"any figures?"}}
  N -- no --> NS["not stated"]
  N -- yes --> J7[["J7 one choice per quantity named<br/>(cost, weight, …) among the figures<br/>+ 'not stated', all in one call"]]
  J7 --> S["sum probability over rows of the same value"]
  S --> A["answer: '80' or 'cost 53, weight 4'<br/>p = least sure part;<br/>highlight the picked cell"]
  class G,J7 jev
  class N dec
  class A ok
  class NS stop
  classDef jev fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#111827
  classDef dec fill:#fef3c7,stroke:#d97706,color:#111827
  classDef stop fill:#fee2e2,stroke:#dc2626,color:#111827
  classDef ok fill:#dcfce7,stroke:#16a34a,color:#111827
  classDef sub fill:#f3e8ff,stroke:#9333ea,stroke-dasharray:4 3,color:#111827
```

## Truth

The gate's three nouls are the verdict; a false read off a list is checked on the pages either side.

```mermaid
flowchart TD
  M["contents: 'is X a Y?' with Y a section<br/>(no jev call, string match)"] --> ML{{"X listed under Y?"}}
  ML -- yes --> T1["true, p = 1"]
  ML -- no --> RS["read section Y's pages<br/>(contents can leave entries out)"]
  RS --> G
  G[["J5 gate = 3 nouls per page:<br/>states the claim · contradicts it · lists the kind"]] --> V{{"verdict from the gate<br/>(no extra call)"}}
  V -- "stated ≥ 0.5 and ≥ contradicts" --> T["true"]
  V -- "contradicts ≥ 0.5" --> F["false"]
  V -- "lists the kind,<br/>X not among them" --> FL["false, from a list"]
  V -- otherwise --> NS["not stated, walk on"]
  FL --> GL["read up to 3 pages either side<br/>while each still lists the kind"]
  GL --> J8[["J8 same 3 nouls on each page"]]
  J8 --> GV{{"page states or contradicts?"}}
  GV -- yes --> GA["answer from that page"]
  GV -- "no, but X named there" --> NS2["not stated"]
  GV -- "no" --> FK["keep false"]
  class G,J8 jev
  class ML,V,GV dec
  class T1,T,F,GA,FK ok
  class NS,NS2 stop
  classDef jev fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#111827
  classDef dec fill:#fef3c7,stroke:#d97706,color:#111827
  classDef stop fill:#fee2e2,stroke:#dc2626,color:#111827
  classDef ok fill:#dcfce7,stroke:#16a34a,color:#111827
  classDef sub fill:#f3e8ff,stroke:#9333ea,stroke-dasharray:4 3,color:#111827
```

## Passage

One noul per sentence; the best runs are the passage, grown onto later pages while they keep answering.

```mermaid
flowchart TD
  G[["J5 gate: 'contains the answer'"]] --> L["page as laid out: sentences,<br/>headings and table rows as units"]
  L --> J9[["J9 noul per unit: 'part of the answer?'<br/>≤150 per call, whole page in state"]]
  J9 --> R["best runs of units above 0.65;<br/>a note under a table row goes with its row"]
  R --> RR{{"any run?"}}
  RR -- no --> NS["not stated"]
  RR -- yes --> NX{{"next page within section end + 2?"}}
  NX -- yes --> J9n[["J9 on the next page's units"]]
  J9n --> HR{{"it has a run of its own?"}}
  HR -- yes --> NX
  HR -- no --> Q
  NX -- no --> Q{{"question names quantities<br/>and passage has table rows?"}}
  Q -- yes --> J10[["J10 one choice per table × quantity:<br/>which column holds it"]]
  J10 --> K["keep name column + picked columns"]
  Q -- no --> A
  K --> A["passage, p = mean of its units;<br/>highlight its lines"]
  class G,J9,J9n,J10 jev
  class RR,NX,HR,Q dec
  class A ok
  class NS stop
  classDef jev fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#111827
  classDef dec fill:#fef3c7,stroke:#d97706,color:#111827
  classDef stop fill:#fee2e2,stroke:#dc2626,color:#111827
  classDef ok fill:#dcfce7,stroke:#16a34a,color:#111827
  classDef sub fill:#f3e8ff,stroke:#9333ea,stroke-dasharray:4 3,color:#111827
```

## Table to order: request and rows

`composeTable` in compose.ts.

```mermaid
flowchart TD
  J11[["J11 read the request, per word:<br/>row things · column · what to add;<br/>noul: keep the table's own columns?"]] --> AD{{"something to add<br/>and columns named?"}}
  AD -- yes --> J12[["J12 noul per column:<br/>add it beside this column's items?"]]
  AD -- no --> NC
  J12 --> NC{{"rows and columns named?"}}
  NC -- no --> PW["plain passage walk<br/>(a table the book prints)"]
  NC -- yes --> MW["walk: 'Show me the table of all the {things}'<br/>as a passage (J1 · J5 · J9)"]
  MW --> FT{{"a table in the passage?"}}
  FT -- no --> FAIL["no table: no answer"]
  FT -- yes --> MT{{"more than one table?"}}
  MT -- yes --> J13[["J13 choice: which table has<br/>a row per thing asked for"]]
  MT -- no --> J10
  J13 --> J10[["J10 which column of the rows' table<br/>holds each named column"]]
  J10 --> KP{{"keep own columns?"}}
  KP -- yes --> KC["the table's own columns go first"] --> NX
  KP -- no --> NX["rows + placed columns<br/>(next chart)"]
  class J11,J12,J13,J10 jev
  class AD,NC,FT,MT,KP dec
  class FAIL stop
  class PW,MW,NX sub
  classDef jev fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#111827
  classDef dec fill:#fef3c7,stroke:#d97706,color:#111827
  classDef stop fill:#fee2e2,stroke:#dc2626,color:#111827
  classDef ok fill:#dcfce7,stroke:#16a34a,color:#111827
  classDef sub fill:#f3e8ff,stroke:#9333ea,stroke-dasharray:4 3,color:#111827
```

## Table to order: missing columns

A column the rows' table lacks comes from each row's entry, then the row's own cells, then a search of its own.

```mermaid
flowchart TD
  U1{{"columns not placed?"}}
  U1 -- yes --> J14[["J14 entries on the next 8 pages:<br/>choice per column among 'Label: value' labels"]]
  U1 -- no --> NX
  J14 --> U2{{"still not placed?"}}
  U2 -- yes --> J15[["J15 rows' own cells: choice per row × column<br/>among pieces of the row's other cells"]]
  U2 -- no --> NX
  J15 --> HF{{"fills ≥ half the rows?"}}
  HF -- yes --> NX
  HF -- no --> CS["per missing column, walk:<br/>'What is the {column} of each of the {things}?'<br/>3 passages (J1 · J5 · J9)"]
  CS --> J10b[["J10 on the tables it found;<br/>still missing → J10 on every table found"]]
  J10b --> NX["fill the cells (next chart)"]
  class J14,J15,J10b jev
  class U1,U2,HF dec
  class CS,NX sub
  classDef jev fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#111827
  classDef dec fill:#fef3c7,stroke:#d97706,color:#111827
  classDef stop fill:#fee2e2,stroke:#dc2626,color:#111827
  classDef ok fill:#dcfce7,stroke:#16a34a,color:#111827
  classDef sub fill:#f3e8ff,stroke:#9333ea,stroke-dasharray:4 3,color:#111827
```

## Table to order: filling the cells

Rows of other tables matched to ours, gaps filled, values added beside items.

```mermaid
flowchart TD
  IN["every column has a source, or none"] --> MR{{"a column comes<br/>from another table?"}}
  MR -- yes --> J16[["J16 match rows: same name first,<br/>choice per unmatched row"]]
  MR -- no --> GP
  J16 --> GP{{"cells still empty?"}}
  GP -- yes --> J15b[["J15 fill gaps from the rows' own cells"]]
  GP -- no --> AN
  J15b --> AN{{"add requested?"}}
  AN -- yes --> J17[["J17 per column: choice per nearby table,<br/>which column gives the value (+ which row group)<br/>→ 'Long Barrel (+20)'"]]
  AN -- no --> FL
  J17 --> FL{{"any cell filled?"}}
  FL -- yes --> OUT["table printed as a passage,<br/>empty cells N/A, cells highlighted"]
  FL -- no --> BEST["names + N/A, shown as best, not taken"]
  class J16,J15b,J17 jev
  class MR,GP,AN,FL dec
  class OUT ok
  class BEST stop
  classDef jev fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#111827
  classDef dec fill:#fef3c7,stroke:#d97706,color:#111827
  classDef stop fill:#fee2e2,stroke:#dc2626,color:#111827
  classDef ok fill:#dcfce7,stroke:#16a34a,color:#111827
  classDef sub fill:#f3e8ff,stroke:#9333ea,stroke-dasharray:4 3,color:#111827
```
