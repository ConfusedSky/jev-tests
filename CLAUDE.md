
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## This project

What the tools do and how is in README.md and docs/. Notes for working on it:

- Every jev call costs money ($0.042 per million input tokens; output is
  free) and every log step prints its tokens. A new call needs its own
  counted line in the log: a step with lines of its own prints a header
  ending in "…", its lines indented under it, and a sum at its own indent,
  so indented counts add up to the sum below them and the unindented sums
  to `total` (issue #7 is to check this in the bench).
- Measure before adopting: run the bench both ways, rerun any case that
  drops (several vary run to run; their `known` notes say which), and write
  up what was measured, adopted or dropped in docs/ (dead ends in
  docs/dead-ends.md) with the scripts in experiments/, so it is not
  re-derived.
- Ollama with `qwen3-embedding:4b` must be running for the default ranking
  cache and page embeddings; pass `--cache off` without it. The GPU (8 GB)
  may be shared with another project; the 4B then runs partly on the CPU
  (~170 ms a lookup). Don't stop an Ollama you didn't start.

### Tests

```sh
bun test            # offline, free
bun run test:live   # calls jev, spends tokens
bun run bench       # the shelf: real rulebooks, named in .env
```

### The shelf benchmark

`bench.ts` runs every case worked through on the real rulebooks, Heart,
Fallout, Legend in the Mist and Cyberpunk Red, through the same layers the
CLI uses, and scores each against the true answer: a count by how close, a
statement by right or wrong, a passage by the share of its checks met (the
page, the strings it must and must not contain, their order). It prints a
table with the last run's score beside each, marks a case that fell, and
writes the run to `bench/latest.json`, which is committed, so the history is
in git. Cases known to come out wrong stay in the table with the reason, so
the gap is visible rather than hidden.

```sh
bun run bench            # all cases, then write bench/latest.json
bun bench.ts heart       # cases whose book or question matches; not saved
bun bench.ts --no-save   # compare without replacing the last run
```

A full run costs about $0.10 and ranks afresh (`--cache off`) unless given
`--cache MODEL`. Commit a saved run on its own, as "Records the bench run
with …", after the code it measured.

The books are not redistributable, so each is named by an environment
variable (`JEV_HEART_PDF`, `JEV_FALLOUT_PDF`, `JEV_LITM_PDF`, `JEV_CPR_PDF`)
read from `.env`, and a case whose book is unset is skipped.

The live tests are gated behind `JEV_LIVE=1` and assert only the direction of an
answer, never an exact probability. Fixtures are generated PDFs with their
`groff` sources in `fixture/`; rebuild them with `bun run fixture:build`.
