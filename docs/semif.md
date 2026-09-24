# An open model instead of jev

The optional local backend (`--model semif`).

## An open model instead of jev

`--model semif` answers from [SemIf](https://github.com/TheoLeeCJ/SemIf), an
open reimplementation of the same interface: typed option probabilities read
off a local model's logits, Qwen3.5-4B here. `semif/server.py` keeps the model
loaded and takes the same `systemOne` request over HTTP, so nothing above the
client knows which is answering.

```sh
bun run semif:install     # Python 3.12 venv in semif/.venv, SemIf pinned, bitsandbytes
bun run semif:serve       # downloads Qwen3.5-4B once, loads it in 4-bit, listens on :8765
bun jevsec.ts --model semif --chars 12000 book.pdf "Is heretic a calling?"
```

Measured on an RTX 4060 laptop (8 GB) against jev on the same questions:

| call | SemIf | jev |
| --- | ---: | ---: |
| one gate or truth question | 0.15–0.3s | 0.2–0.3s |
| rank 40 titles | 1.9s | 0.3s |
| gate 24 pages in one call | 8.2s | 0.3s |
| live test suite, as it then stood (126 tests) | 34s, 121 pass | 12s, all pass |

At parity on small decisions, and free and offline. Not a match on pages:
prefill runs at about 1,500 tokens a second, a 12k-token batch runs the card
out of memory (hence `--chars 12000`), and the pages of a section are less
sharply told apart (a wrong page at 0.75 beside the right one at 0.95, where
jev held it under 0.05). A count asks a `noul` per scrap of the page, a
hundred or more per page, each a pass over the same text.
