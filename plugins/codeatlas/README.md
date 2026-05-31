# @synnode/codeatlas

MCP server for per-project markdown knowledge bases. Hybrid semantic + keyword search via Ollama, full lifecycle management as MCP tools.

## Requirements

- [Claude Code](https://claude.ai/code)
- [Ollama](https://ollama.com) with `nomic-embed-text`: `ollama pull nomic-embed-text`
- Node.js 18+

## Setup

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "codeatlas": {
      "command": "npx",
      "args": ["-y", "@synnode/codeatlas"],
      "env": {
        "WIKI_ROOT": "/absolute/path/to/project/wiki",
        "RAW_ROOT": "/absolute/path/to/project/raw",
        "OLLAMA_URL": "http://your-ollama-host:11434",
        "OLLAMA_MODEL": "nomic-embed-text"
      }
    }
  }
}
```

Create `wiki/` and `raw/` directories in your project root, then restart Claude Code.

Or use the Claude Code plugin to generate this automatically:

```
claude plugin install github:synnode/codeatlas
/wiki-init
```

## Tools

| Tool | Description |
|---|---|
| `wiki_search` | Hybrid semantic + TF-IDF keyword search |
| `wiki_get` | Fetch full page by name |
| `wiki_update` | Create or update a page (re-embeds automatically) |
| `wiki_patch` | Surgical in-place edit by exact string replacement — auto-bumps `updated`, re-embeds only affected chunks |
| `wiki_ingest` | Process a raw file into wiki pages via Claude |
| `wiki_lint` | Health check: broken links, orphans, stale embeddings |
| `wiki_reembed_all` | Re-embed stale pages (hash-based detection); pass `stale_only:false` to force all |
| `wiki_delete` | Delete a page and remove its vectors |
| `wiki_rename` | Rename a page and rewrite all `[[links]]` across the wiki |
| `wiki_context_for` | Given a source file, auto-detect relevant wiki pages from filename + symbols |
| `wiki_list` | List all pages with title, tags, updated date — optionally filter by tags |

Staleness is determined by comparing each page's current body hash to the hash
stored at last embed — so any out-of-band edit (direct file write, `git pull`,
same-day re-edit) is detected reliably, regardless of `updated:` date granularity.

## Wiki page format

```markdown
---
title: "AuthMiddleware"
tags: [architecture, auth]
related: ["User", "Session"]
updated: 2026-05-02
---

# AuthMiddleware

Content here. Use [[PageName]] for cross-references.
```

## Configuration

| Variable | Required | Description |
|---|---|---|
| `WIKI_ROOT` | yes | Absolute path to `wiki/` folder |
| `RAW_ROOT` | yes | Absolute path to `raw/` folder |
| `OLLAMA_URL` | yes | Ollama base URL |
| `OLLAMA_MODEL` | no | Embedding model (default: `nomic-embed-text`) |
| `DB_PATH` | no | sqlite-vec DB path (default: `{WIKI_ROOT}/.embeddings.db`) |

## License

MIT
