"""Tables on the given pages of a PDF, as JSON on stdout: one object per table
with its rows, each row its cells and its box on the page (top-left origin,
PDF points, like mutool's stext). pdfplumber finds a table by its ruling
lines and cell shading, which is what a rulebook draws its tables with.

    python tables.py book.pdf 97 98
"""
import json
import sys

import pdfplumber

pdf, *pages = sys.argv[1:]
out = []
with pdfplumber.open(pdf) as doc:
    for n in pages:
        page = doc.pages[int(n) - 1]
        for t in page.find_tables():
            rows = []
            for r in t.rows:
                cells = [page.crop(c).extract_text() if c else "" for c in r.cells]
                rows.append({"cells": [" ".join(c.split()) for c in cells], "bbox": [round(v, 2) for v in r.bbox]})
            # A column with nothing in it is a ruling line the table happens to have.
            width = max((len(r["cells"]) for r in rows), default=0)
            keep = [i for i in range(width) if any(i < len(r["cells"]) and r["cells"][i] for r in rows)]
            for r in rows:
                r["cells"] = [r["cells"][i] if i < len(r["cells"]) else "" for i in keep]
            out.append({"page": int(n), "bbox": [round(v, 2) for v in t.bbox], "rows": rows})
json.dump(out, sys.stdout, ensure_ascii=False)
