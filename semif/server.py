"""Serves SemIf as a drop-in for jev's systemOne.

POST / with {"state": ..., "questions": {name: question}} in the TypeSafe shape
and get {"answers": {name: response}} back. Every question over one request
shares the state, so they go through SemIf's shared-prefix scoring in one
forward pass, the way rankTitles and the page batches use jev.

SemIf answers with one letter per option and has sixteen letters, so a choice
with more options than that is run as a tournament: heats of fifteen plus
"none of these", then a final among the heat winners.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from semif_phase1.direct import score as direct_score
from semif_phase1.serial import SerialPrefixScorer
from semif_phase1.shared import _state_prefix, score_shared

HEAT = 15
# Shared scoring replicates the state's cache once per row; past this many
# token-rows an 8 GB card runs out, and the rows go one at a time instead
# over a single cached prefill.
SHARED_BUDGET = 24000
NONE = "\u0000none"


def load(model: str, revision: str, bits: int):
    import torch
    import transformers

    kw = {"revision": revision, "trust_remote_code": False}
    config = transformers.AutoConfig.from_pretrained(model, **kw)
    tokenizer = transformers.AutoTokenizer.from_pretrained(model, **kw)
    cls = transformers.AutoModelForCausalLM
    if config.model_type in {"qwen3_5", "qwen3_5_text"}:
        cls = transformers.Qwen3_5ForCausalLM
        config = config.get_text_config()
    quant = None
    if bits == 4:
        quant = transformers.BitsAndBytesConfig(
            load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16
        )
    elif bits == 8:
        quant = transformers.BitsAndBytesConfig(load_in_8bit=True)
    net = cls.from_pretrained(
        model, config=config, dtype=torch.bfloat16, device_map={"": "cuda:0"}, quantization_config=quant, **kw
    )
    net.eval()
    return net, tokenizer, {"source": model, "revision": revision, "bits": bits}


class Scorer:
    def __init__(self, model, tokenizer, metadata, max_tokens):
        self.model, self.tokenizer, self.metadata, self.max_tokens = model, tokenizer, metadata, max_tokens
        self.serial = SerialPrefixScorer(model, tokenizer, metadata, max_tokens)
        self.tokens = 0

    def rows(self, state, rows: list[dict]) -> dict[str, dict[str, float]]:
        """Option probabilities by row id, every row over the one state in a single pass."""
        if not rows:
            return {}
        for row in rows:
            row["state"] = state
        prefix = len(_state_prefix(self.tokenizer, state))
        if len(rows) == 1:
            out = [direct_score(self.model, self.tokenizer, rows[0], self.metadata, self.max_tokens)]
        elif len(rows) * prefix <= SHARED_BUDGET:
            out, timing = score_shared(self.model, self.tokenizer, rows, self.metadata, self.max_tokens)
            brief = {k: round(v, 2) if isinstance(v, float) else v for k, v in timing.items()}
            print(f"shared {brief}", file=sys.stderr, flush=True)
        else:
            t = time.perf_counter()
            out = [self.serial.score(row) for row in rows]
            print(f"serial {len(rows)} rows over {prefix} prefix tokens in {time.perf_counter() - t:.2f}s "
                  f"(prefill {out[0]['prefill_seconds']:.2f}s)", file=sys.stderr, flush=True)
        self.tokens += sum(r["input_tokens"] for r in out)
        return {r["id"]: dict(zip(r["option_ids"], r["probabilities"])) for r in out}

    @staticmethod
    def row(tag: str, question: str, options: list[tuple[str, str]]) -> dict:
        return {"id": tag, "question": question, "options": [{"id": i, "description": d} for i, d in options]}

    def choose_all(self, state, asks: dict[str, tuple[str, list[tuple[str, str]]]]) -> dict[str, dict[str, float]]:
        """Probabilities per option for every ask at once. An ask with more options
        than SemIf has letters runs as heats of fifteen plus "none of these", then
        a final among the heat winners; each round is one shared pass."""
        rows, heats = [], {}
        for tag, (question, options) in asks.items():
            if len(options) <= HEAT + 1:
                rows.append(self.row(tag, question, options))
                continue
            heats[tag] = []
            for n in range(0, len(options), HEAT):
                heat = options[n : n + HEAT] + [(NONE, "None of these")]
                heats[tag].append(f"{tag}.h{n}")
                rows.append(self.row(f"{tag}.h{n}", question, heat))
        got = self.rows(state, rows)
        out = {tag: got[tag] for tag in asks if tag not in heats}
        finals = {}
        for tag, ids in heats.items():
            question, options = asks[tag]
            by_id = dict(options)
            winners = []
            for hid in ids:
                best = max(got[hid], key=got[hid].get)
                if best != NONE:
                    winners.append((best, by_id[best]))
            out[tag] = {i: 0.0 for i, _ in options}
            if winners:
                finals[tag] = (question, winners)
        if finals:
            for tag, probs in self.choose_all(state, finals).items():
                out[tag].update(probs)
        return out

    def system_one(self, request: dict) -> dict:
        before = self.tokens
        state = request["state"]
        text = lambda v, fallback: fallback if v is None else (v if isinstance(v, str) else json.dumps(v))
        asks, shape = {}, {}
        for name, q in request["questions"].items():
            kind = q["type"]
            instructions = text(q.get("instructions"), "Which option applies?")
            if kind == "noul":
                c = q.get("criteria") or {}
                asks[name] = (instructions, [("yes", text(c.get("true"), "Yes")), ("no", text(c.get("false"), "No"))])
            elif kind == "choice":
                asks[name] = (instructions, [(k, text(v, k)) for k, v in q["criteria"].items()])
            elif kind == "score":
                asks[name] = (instructions, [(str(i), text(d, f"Level {i}")) for i, d in enumerate(q["criteria"])])
            else:
                raise ValueError(f"unknown question type {kind}")
            shape[name] = kind
        probs = self.choose_all(state, asks)
        answers = {}
        for name, p in probs.items():
            kind = shape[name]
            if kind == "noul":
                answers[name] = {"type": "noul", "noul": p["yes"]}
            elif kind == "choice":
                best = max(p, key=p.get)
                answers[name] = {"type": "choice", "choice": best, "confidence": p[best], "probabilities": p}
            else:
                answers[name] = {
                    "type": "score",
                    "score": sum(float(k) * v for k, v in p.items()),
                    "confidence": max(p.values()),
                    "legend": dict(asks[name][1]),
                    "probabilities": p,
                }
        return {"model": self.metadata["source"], "answers": answers, "usage": {"input_tokens": self.tokens - before, "output_tokens": 0}}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model", default="Qwen/Qwen3.5-4B")
    ap.add_argument("--revision", default="851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a")
    ap.add_argument("--bits", type=int, choices=(4, 8, 16), default=4)
    ap.add_argument("--max-tokens", type=int, default=32768)
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    t = time.perf_counter()
    scorer = Scorer(*load(args.model, args.revision, args.bits), args.max_tokens)
    print(f"loaded {args.model} at {args.bits} bits in {time.perf_counter() - t:.1f}s", file=sys.stderr, flush=True)

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            try:
                t = time.perf_counter()
                out = scorer.system_one(body)
                n = len(body["questions"])
                print(f"{n} questions, {out['usage']['input_tokens']} tokens, {time.perf_counter() - t:.2f}s", file=sys.stderr, flush=True)
                code, payload = 200, out
            except Exception as e:  # report to the caller rather than dropping the connection
                code, payload = 500, {"error": f"{type(e).__name__}: {e}"}
            data = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *a):
            pass

    print(f"listening on http://127.0.0.1:{args.port}", file=sys.stderr, flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
