"""
The pages of each PDF given that tables.py moves a table on: drawn from a
corner off pdfplumber's 0,0, or turned. Only there can a passage read
otherwise than when tables were decided in pdfplumber's space. Free.

    .venv/bin/python experiments/pages/origins.py book.pdf ...
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
# Importing tables.py would leave a __pycache__ in the repo's root.
sys.dont_write_bytecode = True

import pdfplumber
from tables import origin

for pdf in sys.argv[1:]:
    moved = 0
    with pdfplumber.open(pdf) as doc:
        for n, page in enumerate(doc.pages, 1):
            o = origin(page)
            if o != [0, 0] or page.rotation:
                moved += 1
                print(f"  p.{n}: origin {o}, rotation {page.rotation}")
        print(f"{moved} of {len(doc.pages)} pages moved or turned: {Path(pdf).name}", flush=True)
