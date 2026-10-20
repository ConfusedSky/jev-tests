#!/usr/bin/env bash
# Runs the bench on another machine (an Ubuntu host reached as root over ssh),
# then removes everything it put there. Run from the repo root:
#   experiments/remote/run.sh root@models-server
# Question embeddings reach this machine's Ollama through `ssh -R`, so start
# Ollama here first; page embeddings and book text go over from the cache.
set -euo pipefail
host=$1
cache=${XDG_CACHE_HOME:-$HOME/.cache}/jev
books=(JEV_HEART_PDF JEV_FALLOUT_PDF JEV_LITM_PDF JEV_CPR_PDF)
set -a; source .env; set +a

ssh "$host" 'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mupdf-tools poppler-utils ripgrep >/dev/null
  curl -fsSL https://bun.sh/install | bash >/dev/null
  curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null
  mkdir -p /root/jev /root/books /root/.cache/jev/embeddings'
git ls-files -z | rsync -a --from0 --files-from=- . "$host:/root/jev/"

env=$(mktemp)
for v in "${books[@]}"; do
  p=${!v}
  # rsync failed on these paths with spaces; a plain stream does not.
  ssh "$host" "cat > '/root/books/${p##*/}'" < "$p"
  ssh "$host" "touch -d @$(stat -c %Y "$p") '/root/books/${p##*/}'"
  echo "$v=\"/root/books/${p##*/}\"" >> "$env"
done
echo "OPENROUTER_API_KEY=$OPENROUTER_API_KEY" >> "$env"
rsync -a "$env" "$host:/root/jev/.env"; rm "$env"
ssh "$host" 'cd /root/jev && PATH=/root/.local/bin:$PATH /root/.bun/bin/bun install --frozen-lockfile >/dev/null && PATH=/root/.local/bin:$PATH /root/.bun/bin/bun run tables:install >/dev/null'

# The cache is keyed by bookKey (path, size, mtime), so each file is renamed
# from this machine's key to the server's, or the server re-embeds every book.
keys='import { bookKey } from "./cache"; for (const v of process.argv.slice(2)) console.log(bookKey(process.env[v]!));'
echo "$keys" > .remote-keys.ts; here=$(bun .remote-keys.ts "${books[@]}"); rm .remote-keys.ts
there=$(ssh "$host" "cd /root/jev && echo '$keys' > .k.ts && /root/.bun/bin/bun .k.ts ${books[*]}; rm .k.ts")
paste -d' ' <(echo "$here") <(echo "$there") | while read -r l r; do
  rsync -a "$cache/$l.txt" "$host:/root/.cache/jev/$r.txt"
  rsync -a "$cache/embeddings/$l-pages-qwen3-4b.json" "$host:/root/.cache/jev/embeddings/$r-pages-qwen3-4b.json"
done

ssh -o ExitOnForwardFailure=yes -R 11434:localhost:11434 "$host" \
  'cd /root/jev && /usr/bin/time -f "WALL %e s" /root/.bun/bin/bun bench.ts --no-save' || true

ssh "$host" 'rm -rf /root/jev /root/books /root/.cache/jev /root/.cache/uv /root/.bun /root/.local/bin/uv /root/.local/bin/uvx \
    /root/.local/bin/env /root/.local/bin/env.fish /root/.local/share/uv /root/.config/uv /root/.config/fish /root/.zshrc
  sed -i "/\.local\/bin\/env/d;/^# bun$/d;/BUN_INSTALL/d" /root/.bashrc /root/.profile
  DEBIAN_FRONTEND=noninteractive apt-get remove -y -qq --autoremove mupdf-tools poppler-utils ripgrep >/dev/null'
