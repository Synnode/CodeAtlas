/**
 * wiki-lint.ts
 *
 * MCP tool: wiki_lint
 * Runs a health check on the entire wiki and returns a structured report.
 *
 * Checks:
 *   1. Broken links — [[PageName]] refs where PageName.md does not exist
 *   2. Orphan pages — pages with no incoming links
 *   3. Missing frontmatter — pages lacking title, tags, or updated
 *   4. Stale embeddings — pages whose frontmatter updated > last embed time
 *   5. Missing concepts — capitalized noun phrases appearing 3+ times without a dedicated page
 */

import { z } from "zod";
import matter from "gray-matter";
import * as fs from "fs";
import { readAllPages, extractWikiLinks, resolvePage } from "../lib/wiki-fs";
import { getPageContentHash } from "../lib/vector-store";
import { bodyHash } from "../lib/content-hash";
import { getDb } from "../db";

export const WikiLintSchema = z.object({
  fix: z
    .boolean()
    .optional()
    .describe("If true, auto-fix missing 'updated' frontmatter dates in place"),
});

export type WikiLintInput = z.infer<typeof WikiLintSchema>;

export interface BrokenLink {
  page: string;
  link: string;
  suggestion: string | null;
}

export interface FixedField {
  page: string;
  field: string;
  value: string;
}

export interface WikiLintResult {
  broken_links: BrokenLink[];
  orphan_pages: string[];
  missing_frontmatter: Array<{ page: string; missing: string[] }>;
  stale_embeddings: string[];
  missing_concepts: string[];
  fixed?: FixedField[];
}

export interface WikiLintError {
  error: string;
  code: string;
}

export type WikiLintOutput = WikiLintResult | WikiLintError;

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function findClosestPage(link: string, pageNames: string[]): string | null {
  if (pageNames.length === 0) return null;
  const linkLower = link.toLowerCase();
  let best: string | null = null;
  let bestDist = Infinity;
  for (const name of pageNames) {
    const dist = editDistance(linkLower, name.toLowerCase());
    const maxLen = Math.max(link.length, name.length);
    if (dist < bestDist && dist / maxLen < 0.4) {
      bestDist = dist;
      best = name;
    }
  }
  return best;
}

/**
 * Extracts capitalized noun phrases (2+ word sequences or single capitalized words)
 * that look like concept names from text.
 */
function extractConceptCandidates(text: string): string[] {
  const candidates: string[] = [];

  // Only multi-word Title Case phrases — avoids false positives from single
  // PascalCase code identifiers (DoorController, AudioSource, etc.)
  const phraseRegex = /(?<!\[\[)\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b(?!\]\])/g;
  let match: RegExpExecArray | null;
  while ((match = phraseRegex.exec(text)) !== null) {
    candidates.push(match[1]);
  }

  return candidates;
}

/**
 * Handles the wiki_lint tool call.
 */
export async function wikiLint(input: WikiLintInput = {}): Promise<WikiLintOutput> {
  const { fix } = input;

  let pages;
  try {
    pages = await readAllPages();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: `Failed to read wiki pages: ${message}`,
      code: "READ_ERROR",
    };
  }

  const pageNames = new Set(pages.map((p) => p.name));
  const pageNameList = [...pageNames];
  const db = getDb();

  const brokenLinks: BrokenLink[] = [];
  const referencedPages = new Set<string>();
  const missingFrontmatter: Array<{ page: string; missing: string[] }> = [];
  const staleEmbeddings: string[] = [];
  const conceptFrequency = new Map<string, number>();
  const fixed: FixedField[] = [];
  const today = new Date().toISOString().split("T")[0];

  for (const page of pages) {
    const links = extractWikiLinks(page.content);
    for (const link of links) {
      referencedPages.add(link);
      if (!pageNames.has(link)) {
        brokenLinks.push({ page: page.name, link, suggestion: findClosestPage(link, pageNameList) });
      }
    }

    const fm = page.frontmatter;
    const missing: string[] = [];
    if (!fm["title"]) missing.push("title");
    if (!fm["tags"]) missing.push("tags");
    if (!fm["updated"]) missing.push("updated");

    // Auto-fix: write missing 'updated' date into frontmatter
    if (fix && !fm["updated"]) {
      try {
        const parsed = matter(page.content);
        parsed.data["updated"] = today;
        const newContent = matter.stringify(parsed.content, parsed.data);
        fs.writeFileSync(resolvePage(page.name), newContent, "utf-8");
        fixed.push({ page: page.name, field: "updated", value: today });
        missing.splice(missing.indexOf("updated"), 1);
      } catch {
        // non-fatal
      }
    }

    if (missing.length > 0) {
      missingFrontmatter.push({ page: page.name, missing });
    }

    const storedHash = getPageContentHash(db, page.name);
    if (storedHash === null || storedHash !== bodyHash(page.body)) {
      staleEmbeddings.push(page.name);
    }

    const candidates = extractConceptCandidates(page.body);
    for (const candidate of candidates) {
      conceptFrequency.set(candidate, (conceptFrequency.get(candidate) ?? 0) + 1);
    }
  }

  const orphanPages = pages
    .filter((p) => !referencedPages.has(p.name))
    .map((p) => p.name);

  const missingConcepts: string[] = [];
  for (const [concept, count] of conceptFrequency.entries()) {
    if (count >= 3 && !pageNames.has(concept)) {
      missingConcepts.push(concept);
    }
  }
  missingConcepts.sort();

  return {
    broken_links: brokenLinks,
    orphan_pages: orphanPages,
    missing_frontmatter: missingFrontmatter,
    stale_embeddings: staleEmbeddings,
    missing_concepts: missingConcepts,
    ...(fixed.length > 0 ? { fixed } : {}),
  };
}
