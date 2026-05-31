/**
 * wiki-patch.ts
 *
 * MCP tool: wiki_patch
 * Surgical, in-place edit of a single wiki page by exact string replacement —
 * mirrors the host editor's Edit tool. Auto-bumps the `updated:` frontmatter
 * field, re-embeds only the affected chunks, and updates the body hash.
 *
 * Prefer this over wiki_update for small edits to long pages: no re-sending
 * the whole body, lower token cost, lower transcription-error risk.
 */

import { z } from "zod";
import matter from "gray-matter";
import { readPage, writePage, validateFrontmatter } from "../lib/wiki-fs";
import { reembedPageBody } from "../lib/page-embed";
import { invalidateIndex } from "../lib/tfidf";
import { getDb } from "../db";

export const WikiPatchSchema = z.object({
  page: z.string().min(1).describe("Page name without .md extension, e.g. 'AccessManager'"),
  old_string: z
    .string()
    .min(1)
    .describe("Exact substring to find in the page body. Must be unique unless replace_all is true."),
  new_string: z.string().describe("Replacement text. May be empty to delete the match."),
  replace_all: z
    .boolean()
    .optional()
    .describe("If true, replace every occurrence of old_string. Default false; errors if old_string is non-unique."),
});

export type WikiPatchInput = z.infer<typeof WikiPatchSchema>;

export interface WikiPatchSuccess {
  success: true;
  replacements: number;
  chunks_embedded: number;
  chunks_skipped: number;
  path: string;
  updated: string;
}

export interface WikiPatchError {
  error: string;
  code: string;
  match_count?: number;
}

export type WikiPatchResult = WikiPatchSuccess | WikiPatchError;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

export async function wikiPatch(input: WikiPatchInput): Promise<WikiPatchResult> {
  const { page, old_string, new_string, replace_all } = input;

  if (old_string === new_string) {
    return {
      error: "old_string and new_string are identical — nothing to patch.",
      code: "NO_OP",
    };
  }

  const existing = readPage(page);
  if (!existing) {
    return {
      error: `Page "${page}" does not exist. Use wiki_update to create it.`,
      code: "PAGE_NOT_FOUND",
    };
  }

  const body = existing.body;
  const matchCount = countOccurrences(body, old_string);

  if (matchCount === 0) {
    return {
      error: `old_string not found in page "${page}".`,
      code: "OLD_STRING_NOT_FOUND",
      match_count: 0,
    };
  }

  if (matchCount > 1 && !replace_all) {
    return {
      error: `old_string is not unique in page "${page}" (${matchCount} matches). Pass replace_all:true or extend old_string with surrounding context to make it unique.`,
      code: "OLD_STRING_NOT_UNIQUE",
      match_count: matchCount,
    };
  }

  // Apply replacement (split/join = exact-string, no regex semantics)
  const newBody = replace_all
    ? body.split(old_string).join(new_string)
    : body.replace(old_string, new_string);

  // Auto-bump updated
  const frontmatter = { ...existing.frontmatter, updated: todayISO() };

  const missing = validateFrontmatter(frontmatter);
  if (missing.length > 0) {
    return {
      error: `Page frontmatter is missing required fields after patch: ${missing.join(", ")}.`,
      code: "MISSING_FRONTMATTER_FIELDS",
    };
  }

  const newContent = matter.stringify(newBody, frontmatter);

  let filePath: string;
  try {
    filePath = writePage(page, newContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Failed to write page to disk: ${message}`, code: "WRITE_ERROR" };
  }

  const db = getDb();
  let reembed;
  try {
    reembed = await reembedPageBody(db, page, newBody);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Failed to re-embed page: ${message}`, code: "EMBEDDING_ERROR" };
  }

  invalidateIndex();

  return {
    success: true,
    replacements: replace_all ? matchCount : 1,
    chunks_embedded: reembed.embedded,
    chunks_skipped: reembed.skipped,
    path: filePath,
    updated: frontmatter.updated as string,
  };
}
