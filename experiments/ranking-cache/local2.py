# Embeds texts2.json with local models; writes embs/local_<name>.json. Usage: local.py <hf id> [st|siglip] [cuda|cpu]
import json, sys, time, statistics, torch
S = __file__.rsplit("/", 1)[0]
T = json.load(open(f"{S}/texts2.json"))
mid, kind, dev = sys.argv[1], sys.argv[2], sys.argv[3]
if dev == "cuda": torch.cuda.reset_peak_memory_stats()
t0 = time.time()
if kind == "st":
    from sentence_transformers import SentenceTransformer
    m = SentenceTransformer(mid, device=dev, model_kwargs={"torch_dtype": torch.float16 if dev == "cuda" else (torch.bfloat16 if "4B" in mid else torch.float32)})
    enc = lambda xs: m.encode(xs, normalize_embeddings=True, batch_size=16).tolist()
    params = sum(p.numel() for p in m.parameters())
else:
    from transformers import AutoModel, AutoTokenizer
    m = AutoModel.from_pretrained(mid, torch_dtype=torch.float16 if dev == "cuda" else torch.float32).to(dev).eval(); p = AutoTokenizer.from_pretrained(mid)
    def enc(xs):
        with torch.no_grad():
            i = p(xs, padding="max_length", truncation=True, max_length=64, return_tensors="pt").to(dev)
            f = m.get_text_features(**i)
            f = getattr(f, "pooler_output", f)
            return torch.nn.functional.normalize(f, dim=-1).tolist()
    params = sum(p_.numel() for p_ in m.text_model.parameters())
load = time.time() - t0
out = {k: enc(T[k]) for k in T}
lat = []
for q in T["q"][:7]:
    s = time.perf_counter(); enc([q]); 
    if dev == "cuda": torch.cuda.synchronize()
    lat.append((time.perf_counter() - s) * 1000)
out.update(model=mid, device=dev, params=params, loadS=load, msPerQuery=statistics.median(lat[2:]), dim=len(out["q"][0]),
           peakVramMB=torch.cuda.max_memory_allocated() / 2**20 if dev == "cuda" else 0)
json.dump(out, open(f"{S}/embs2/local_{mid.split('/')[-1]}.json", "w"))
print(mid, dev, f"params {params/1e6:.0f}M load {load:.1f}s query {out['msPerQuery']:.1f}ms vram {out['peakVramMB']:.0f}MB dim {out['dim']}")
