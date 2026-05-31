---
name: wiki
description: >
  Use this skill to interact with the project wiki knowledge base.
  Invoke autonomously when starting a task, after implementing something new,
  after discovering something non-obvious (a gotcha, constraint, or design decision),
  after debugging or investigating a problem, or when uncertain about existing architecture.
---

# Wiki Knowledge Base

This project has a wiki knowledge base accessible via MCP tools.
Always prefer wiki knowledge over assumptions. When in doubt, search first.

## Autonomous triggers — act without being asked

| Situation | Action |
|---|---|
| Starting any non-trivial task | `wiki_search` with 2-3 relevant keywords |
| Opening a source file | `wiki_context_for` with the file path |
| After implementing or deciding something | `wiki_update` to record it |
| After discovering a gotcha, constraint, or non-obvious behavior | `wiki_update` to record the finding |
| After debugging or root-causing a problem | `wiki_update` with cause + fix, so next session doesn't re-investigate |
| User provides a spec, doc, notes, or URL | `wiki_search` for context → `wiki_ingest` |
| After renaming, deleting, or large refactor | `wiki_lint` to catch broken links |
| Wiki feels stale or out of sync | `wiki_reembed_all` to refresh vectors |

## Workflow

### Search (default starting point)
```
wiki_search({ query: "...", mode: "hybrid" })   // always start here
wiki_get({ page: "PageName" })                  // when you need full content
wiki_list({ tags: ["auth"] })                   // when you need an overview
```

### Open file → auto-load context
```
wiki_context_for({ path: "src/auth/middleware.ts" })
```
Run this immediately when opening any source file. Returns the most relevant
wiki pages without you having to guess search terms.

### Ingest new source material
```
// Step 1 — prepare
wiki_ingest({ file: "notes.md" })     // or url: "https://..."

// Step 2 — wiki_ingest returns raw_files + instructions
// Read the instructions field, then for each page call:
wiki_update({ page: "PageName", content: "..." })

// Never call wiki_ingest again inside the same ingest flow.
```

### Write / update
```
wiki_update({ page: "AuthMiddleware", content: "---\ntitle: ...\n---\n..." })
wiki_update({ page: "AuthMiddleware", content: "...", dry_run: true })  // preview
wiki_update({ page: "AuthMiddleware", content: "...", git_commit: true })
```

### Surgical edit (prefer for small changes to long pages)
```
wiki_patch({
  page: "AuthMiddleware",
  old_string: "| token-ttl | 15m |",     // must be unique within the page body
  new_string: "| token-ttl | 30m |",
})
wiki_patch({ page: "...", old_string: "...", new_string: "...", replace_all: true })
```
Use `wiki_patch` instead of `wiki_update` whenever you only need to change a
few lines on a long page — it costs far fewer tokens than re-sending the full
body, and `updated:` is auto-bumped for you. Fall back to `wiki_update` for
new pages, full rewrites, or structural changes.

### Maintenance
```
wiki_lint()                          // health check — run after big changes
wiki_lint({ fix: true })             // auto-fix missing updated dates
wiki_rename({ from: "Old", to: "New" })  // rewrites all [[links]] atomically
wiki_delete({ page: "Deprecated" })
wiki_reembed_all()                   // re-embed stale pages only (default)
wiki_reembed_all({ stale_only: false })  // force full re-embed
```

## Page format

```markdown
---
title: "PageName"
tags: [lowercase, hyphen-separated]
related: ["OtherPage"]
updated: 2026-05-09
---

# PageName

One-paragraph summary (max 3 sentences).

## Content
...

## Related
- [[OtherPage]]
```

Required fields: `title`, `tags`, `updated`. Use `[[PageName]]` for all cross-references.

## Rules

- **Never duplicate** content that already exists on a linked page — reference it instead
- **Never create a page** without real content to add — check for duplicates first with `wiki_search`
- **Never call `wiki_ingest` twice** in the same flow — it returns instructions, then you call `wiki_update`
- **Always search before ingesting** — prevents creating duplicate pages for existing concepts
- **Keep summaries short** — the first paragraph should be ≤3 sentences; details go in sections below
