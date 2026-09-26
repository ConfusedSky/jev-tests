"""Tables on the given pages of a PDF, as JSON on stdout: one object per table
with its box and its rows, each row its cells, its box and each cell's box, in
PDF points from the top left of the page as mutool draws it, where its stext
puts a line. pdfplumber finds a table by its ruling lines and cell shading,
which is what a rulebook draws its tables with.

    python tables.py book.pdf 97 98
"""
import json
import sys

import pdfplumber


def origin(page):
    """
    Where the page mutool draws starts, in pdfplumber's space: pdfplumber
    measures from the MediaBox's corner, mutool from the CropBox's (cut to
    the MediaBox), each turned as /Rotate turns the page.
    """
    mx0, mx1 = sorted(page.page_obj.mediabox[0::2])
    my0, my1 = sorted(page.page_obj.mediabox[1::2])
    cx0, cx1 = sorted(page.page_obj.cropbox[0::2])
    cy0, cy1 = sorted(page.page_obj.cropbox[1::2])
    cx0, cy0, cx1, cy1 = max(cx0, mx0), max(cy0, my0), min(cx1, mx1), min(cy1, my1)
    if cx0 >= cx1 or cy0 >= cy1:
        cx0, cy0, cx1, cy1 = mx0, my0, mx1, my1
    # The CropBox corner drawn top left, from the MediaBox corner drawn there.
    x, y = {
        90: (cy0 - my0, cx0 - mx0),
        180: (mx1 - cx1, cy0 - my0),
        270: (my1 - cy1, mx1 - cx1),
    }.get(page.rotation, (cx0 - mx0, my1 - cy1))
    return [round(page.mediabox[0] + x, 2), round(page.mediabox[1] + y, 2)]


def tables(page):
    # Every box leaves here moved onto the page mutool draws, so which lines
    # are a table's, where its rows go and what they mark share one space.
    ox, oy = origin(page)
    moved = lambda b: [round(b[0] - ox, 2), round(b[1] - oy, 2), round(b[2] - ox, 2), round(b[3] - oy, 2)]
    for t in page.find_tables():
        rows = []
        for r in t.rows:
            cells = [page.crop(c).extract_text() if c else "" for c in r.cells]
            rows.append({
                "cells": [" ".join(c.split()) for c in cells],
                "bbox": moved(r.bbox),
                "boxes": [moved(c) if c else None for c in r.cells],
            })
        # A column with nothing in it is a ruling line the table happens to have.
        width = max((len(r["cells"]) for r in rows), default=0)
        keep = [i for i in range(width) if any(i < len(r["cells"]) and r["cells"][i] for r in rows)]
        for r in rows:
            r["cells"] = [r["cells"][i] if i < len(r["cells"]) else "" for i in keep]
            r["boxes"] = [r["boxes"][i] if i < len(r["boxes"]) else None for i in keep]
        yield {"bbox": moved(t.bbox), "rows": rows}


if __name__ == "__main__":
    pdf, *pages = sys.argv[1:]
    with pdfplumber.open(pdf) as doc:
        out = [{"page": int(n), **t} for n in pages for t in tables(doc.pages[int(n) - 1])]
    json.dump(out, sys.stdout, ensure_ascii=False)
