# CodeAtlas — Claude Instructions

## Project structure

```
.claude-plugin/marketplace.json         # root-level plugin registry
plugins/codeatlas/
  .claude-plugin/plugin.json            # plugin metadata (version must match package.json)
  commands/                             # slash commands (markdown, loaded by Claude Code)
  skills/wiki/SKILL.md                  # skill prompt (auto-triggers on wiki tasks)
  src/                                  # TypeScript source
    cli.ts                              # entrypoint — routes init vs MCP server
    index.ts                            # MCP server: registers all tools, handles calls
    config.ts                           # reads env vars, exits if required ones missing
    db.ts                               # singleton DB init (async — queries Ollama for dim)
    init.ts                             # `codeatlas init` command implementation
    lib/
      chunker.ts                        # splits page body into overlapping chunks
      embedder.ts                       # Ollama /api/embeddings client
      rrf.ts                            # Reciprocal Rank Fusion combiner
      tfidf.ts                          # TF-IDF keyword index (natural library)
      vector-store.ts                   # sqlite-vec wrapper (cosine similarity search)
      wiki-fs.ts                        # filesystem helpers (read/write/list pages)
      symbol-extractor.ts               # extracts symbols from source files for wiki_context_for
    tools/                              # one file per MCP tool
    prompts/                            # prompt templates (ingest instructions)
  scripts/
    postbuild.js                        # adds shebang + chmod to dist/cli.js after tsc
    postinstall.js                      # rebuilds native modules (better-sqlite3, sqlite-vec)
    release.js                          # bumps version atomically, builds, tags, publishes
```

## Build

```bash
cd plugins/wiki
npm install
npm run build       # tsc + postbuild (shebang + chmod)
npm run dev         # tsc --watch
```

## Release

```bash
npm run release             # patch bump (1.4.5 → 1.4.6)
npm run release:minor       # minor bump
npm run release:major       # major bump
node scripts/release.js --dry-run   # preview without git/npm side effects
```

Release script: bumps version in `package.json` AND `plugin.json` atomically, builds, `git commit + tag`, `npm publish`. Aborts if the two versions are out of sync before bumping.

## Key gotchas

**`config.ts` exits at import** — reads env vars at module load, calls `process.exit(1)` if required vars missing. `cli.ts` uses `require()` (not `import`) for `./index` and `./init` to defer config loading until after the argv check.

**`zodToJsonSchema` in `index.ts`** — uses `require('zod-to-json-schema')` instead of an `import` because the library's generic types cause tsc to OOM at ~4GB heap when used with a normal import + type inference. The `require` bypasses type evaluation entirely. Do not convert this to an `import`.

**Native modules** — `better-sqlite3` and `sqlite-vec` are native Node addons. They must be compiled for the running Node version. `postinstall.js` handles this automatically; if the MCP server crashes on load, run `npm rebuild better-sqlite3 sqlite-vec` in `plugins/codeatlas/`.

**TF-IDF, not BM25** — `tfidf.ts` uses `natural.TfIdf`. Does not normalize by document length. Renamed from `bm25.ts` in v1.4.x.

**Tag filter is in-memory** — `wiki_search` tag filtering uses `getPageTags()` from `tfidf.ts`, which reads from the in-memory index built during the first search. No disk reads per result. If the index is dirty (after `wiki_update`/`wiki_delete`/`wiki_rename`), it is rebuilt on next search call.

**Embedding dimension** — detected from Ollama at startup by embedding a single space and measuring output length. Stored in `wiki_meta` table on first run. Never hardcoded.

**`wiki_ingest` does not call Claude** — it returns a structured payload (`raw_files`, `existing_pages`, `instructions`) and expects Claude to call `wiki_update` for each page. The MCP server itself has no Anthropic SDK dependency.

**Always re-embed via `reembedPageBody`** — `lib/page-embed.ts` is the single codepath for incremental page re-embedding. It does the chunk diff, embeds only changed chunks, calls `upsertPage`, **and** writes the per-page body hash via `setPageContentHash`. Never call `upsertPage` directly from a tool — bypassing the helper leaves `wiki_page_meta` stale, which causes the page to be flagged as stale on every subsequent `wiki_reembed_all` / `wiki_lint` run.

**Staleness is hash-based, not date-based** — `wiki_reembed_all` and `wiki_lint` compare `bodyHash(body)` (sha256 over `matter().content`, frontmatter excluded) against the value in `wiki_page_meta`. `updated:` is purely human-facing metadata. A null stored hash → page is treated as stale (covers pre-v1.6 DBs and pages that have never been embedded).

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `WIKI_ROOT` | yes | — | Absolute path to wiki markdown directory |
| `OLLAMA_URL` | yes | — | Ollama base URL, e.g. `http://192.168.1.10:11434` |
| `OLLAMA_MODEL` | no | `nomic-embed-text` | Embedding model name |
| `RAW_ROOT` | no | `""` | Directory for raw ingest source files |
| `DB_PATH` | no | `$WIKI_ROOT/.embeddings.db` | SQLite database path |

## Release checklist

Before every release, verify:

1. `README.md` reflects any new/changed behavior — tool descriptions, config, limits, fallbacks
2. `ROADMAP.md` marks completed items as ✅ and lists new backlog items
3. `CLAUDE.md` updated if architecture, gotchas, or workflow changed
4. `git add -f CLAUDE.md` — always force-add, it's in global gitignore
5. Commit all changes first, then run `npm run release` from `plugins/codeatlas/`
6. Push with `git push origin main --tags`

## Version sync rule

`plugins/codeatlas/package.json` and `plugins/codeatlas/.claude-plugin/plugin.json` must have the same `version`.

**Always use `npm run release` to publish.** Never bump versions manually or run `npm publish` directly — the release script is the only safe path because it syncs both files atomically and aborts if they are already out of sync. If you bump manually, the next release will fail with a version mismatch error.
