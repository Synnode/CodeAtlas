# CodeAtlas Roadmap

## ✅ v1.1 — Polish & robustness

- Auto-detect embedding dimensions — query Ollama for model info instead of hardcoding `FLOAT[768]`
- `wiki_delete` tool — remove a page + its vectors
- `wiki_rename` tool — rename page + rewrite all incoming `[[links]]` in one atomic op
- Validate links on write — `wiki_update` warns when content references `[[PageName]]` that doesn't exist yet
- PostInstall hook — run `npm install + rebuild` automatically on plugin install/update

## ✅ v1.2 — Code-aware context

- `wiki_context_for(file)` tool — given a source file path, extracts filename + symbols and returns the most relevant wiki pages automatically
- `wiki_update({ dry_run: true })` — preview changes without writing
- Tag filtering — `wiki_search({ query, tags: ["auth", "mqtt"] })` to scope results
- `wiki_list` tool — enumerate all pages with title, tags, updated date

## ✅ v1.3 — Ingest pipeline

- Batch ingest — `wiki_ingest({ files: ["a.md", "b.md"] })` processes multiple files in one call
- Ingest from URL — fetch a web page or GitHub file and ingest directly
- Ingest deduplication — before writing, check cosine sim against existing pages

## ✅ v1.4 — Maintenance tooling

- `wiki_lint --fix` — auto-fix simple issues: missing `updated` date, broken link suggestions
- `wiki_reembed_all` — batch re-embed all stale pages in one call
- Git integration — optionally `git add + commit` wiki pages after `wiki_update`
- Incremental re-embedding — only re-embed chunks whose content changed

## ✅ v1.5 — Robustness & quality

- Ollama fallback — hybrid search degrades to TF-IDF-only when Ollama is unavailable
- Ingest context — picks semantically relevant existing pages as context (was: first N pages)
- Raw file truncation — large sources capped at 40k chars to prevent context overflow
- Security — `execSync` → `execFileSync` to eliminate shell injection in `git_commit` path
- Schema — replace custom `zodToJsonSchema` with `zod-to-json-schema` (array `items` now correct)
- Release script — atomic version bump across `package.json` + `plugin.json`, build, tag, publish

## ✅ v1.6 — Surgical edits & reliable staleness

- `wiki_patch` — exact-string surgical page edit (`old_string`/`new_string`, `replace_all`), auto-bumps `updated`, re-embeds only affected chunks. Avoids full-page resends for small edits to long pages.
- Content-hash staleness — `wiki_reembed_all` and `wiki_lint` now compare per-page body hashes (sha256 over body, excl. frontmatter) instead of `updated:` date vs embed timestamp. Same-day and out-of-band edits are detected reliably.
- New `wiki_page_meta` table holds the per-page hash; backwards-compat via `CREATE TABLE IF NOT EXISTS` — first run after upgrade treats all pages as stale once, then stabilises.
- Shared `reembedPageBody` helper consolidates incremental re-embedding across `wiki_update`, `wiki_patch`, `wiki_reembed_all`.

## Backlog / next

- **OpenAI / local embedding fallback** — configurable embedding provider, not Ollama-only
- **Obsidian-compatible graph export** — JSON adjacency list for `[[link]]` visualization
- **Multi-wiki support** — single MCP server serving multiple `WIKI_ROOT` paths (monorepos)
- **`/wiki-update` slash command** — convenience wrapper around `wiki_update` MCP tool
- **Watch mode** — auto-ingest on file change in `RAW_ROOT`
- **Page templates** — frontmatter scaffolding for common page types
- **`wiki_patch` heading mode** — second mode keyed by `## heading` for replace/append of whole sections. Deferred from v1.6; the `old_string`/`new_string` path covers the common case.
