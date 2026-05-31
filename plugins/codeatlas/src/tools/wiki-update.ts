/**
 * wiki-update.ts
 *
 * MCP tool: wiki_update
 * Creates or updates a wiki page, re-embeds it in the vector store,
 * and invalidates the TF-IDF index.
 */

import { z } from "zod";
import { execFileSync } from "child_process";
import matter from "gray-matter";
import { readPage, writePage, validateFrontmatter, extractWikiLinks, pageExists } from "../lib/wiki-fs";
import { reembedPageBody } from "../lib/page-embed";
import { invalidateIndex } from "../lib/tfidf";
import { getDb } from "../db";

export const WikiUpdateSchema = z.object({
  page: z.string().min(1).describe("Page name without .md extension, e.g. 'AccessManager'"),
  content: z.string().min(1).describe("Full markdown content including YAML frontmatter"),
  reason: z.string().optional().describe("Brief description of why this page was updated"),
  dry_run: z.boolean().optional().describe("If true, validate and diff without writing to disk or re-embedding"),
  git_commit: z.boolean().optional().describe("If true, run git add + git commit after writing the page"),
});

export type WikiUpdateInput = z.infer<typeof WikiUpdateSchema>;

export interface WikiUpdateSuccess {
  success: true;
  chunks_embedded: number;
  chunks_skipped: number;
  path: string;
  git_committed?: boolean;
  missing_links?: string[];
}

export interface WikiUpdateDryRun {
  dry_run: true;
  page: string;
  is_new: boolean;
  old_content: string | null;
  new_content: string;
  line_changes: { added: number; removed: number };
  missing_links?: string[];
}

export interface WikiUpdateError {
  error: string;
  code: string;
}

export type WikiUpdateResult = WikiUpdateSuccess | WikiUpdateDryRun | WikiUpdateError;

function diffLines(oldText: string, newText: string): { added: number; removed: number } {
  const count = (text: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (const line of text.split("\n")) map.set(line, (map.get(line) ?? 0) + 1);
    return map;
  };
  const oldCounts = count(oldText);
  const newCounts = count(newText);
  let added = 0;
  let removed = 0;
  for (const [line, n] of newCounts) added += Math.max(0, n - (oldCounts.get(line) ?? 0));
  for (const [line, n] of oldCounts) removed += Math.max(0, n - (newCounts.get(line) ?? 0));
  return { added, removed };
}

/**
 * Handles the wiki_update tool call.
 */
export async function wikiUpdate(input: WikiUpdateInput): Promise<WikiUpdateResult> {
  const { page, content, dry_run, git_commit } = input;

  // Parse and validate frontmatter
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: `Failed to parse frontmatter: ${message}`,
      code: "INVALID_FRONTMATTER",
    };
  }

  const missing = validateFrontmatter(parsed.data);
  if (missing.length > 0) {
    return {
      error: `Page frontmatter is missing required fields: ${missing.join(", ")}. All wiki pages must have "title", "tags", and "updated" fields.`,
      code: "MISSING_FRONTMATTER_FIELDS",
    };
  }

  const referencedLinks = extractWikiLinks(parsed.content);
  const missingLinks = referencedLinks.filter((link) => !pageExists(link));

  if (dry_run) {
    const existing = readPage(page);
    const oldContent = existing?.content ?? null;
    return {
      dry_run: true,
      page,
      is_new: !existing,
      old_content: oldContent,
      new_content: content,
      line_changes: oldContent ? diffLines(oldContent, content) : { added: content.split("\n").length, removed: 0 },
      ...(missingLinks.length > 0 ? { missing_links: missingLinks } : {}),
    };
  }

  // Capture existence before writing so the git commit message can pick the right verb
  const pagePreexisted = pageExists(page);

  // Write page to disk
  let filePath: string;
  try {
    filePath = writePage(page, content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: `Failed to write page to disk: ${message}`,
      code: "WRITE_ERROR",
    };
  }

  // Re-embed (incremental) + write content hash
  const db = getDb();
  let reembed;
  try {
    reembed = await reembedPageBody(db, page, parsed.content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: `Failed to re-embed page: ${message}`,
      code: "EMBEDDING_ERROR",
    };
  }

  // Invalidate TF-IDF index so it's rebuilt on next search
  invalidateIndex();

  // Optional git commit
  let gitCommitted: boolean | undefined;
  if (git_commit) {
    try {
      execFileSync("git", ["add", filePath], { stdio: "pipe" });
      const verb = pagePreexisted ? "update" : "create";
      execFileSync("git", ["commit", "-m", `wiki: ${verb} ${page}`], { stdio: "pipe" });
      gitCommitted = true;
    } catch {
      gitCommitted = false;
    }
  }

  return {
    success: true,
    chunks_embedded: reembed.embedded,
    chunks_skipped: reembed.skipped,
    path: filePath,
    ...(gitCommitted !== undefined ? { git_committed: gitCommitted } : {}),
    ...(missingLinks.length > 0 ? { missing_links: missingLinks } : {}),
  };
}
