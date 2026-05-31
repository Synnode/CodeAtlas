import { z } from "zod";
import { readAllPages } from "../lib/wiki-fs";
import { getPageContentHash } from "../lib/vector-store";
import { bodyHash } from "../lib/content-hash";
import { reembedPageBody } from "../lib/page-embed";
import { invalidateIndex } from "../lib/tfidf";
import { getDb } from "../db";

export const WikiReembedAllSchema = z.object({
  stale_only: z
    .boolean()
    .optional()
    .describe(
      "If true (default), only re-embed pages whose body hash differs from the stored hash. If false, re-embed all pages."
    ),
});

export type WikiReembedAllInput = z.infer<typeof WikiReembedAllSchema>;

export interface WikiReembedAllResult {
  reembedded: string[];
  skipped: string[];
  errors: Array<{ page: string; error: string }>;
  total: number;
}

export interface WikiReembedAllError {
  error: string;
  code: string;
}

export type WikiReembedAllOutput = WikiReembedAllResult | WikiReembedAllError;

export async function wikiReembedAll(input: WikiReembedAllInput): Promise<WikiReembedAllOutput> {
  const staleOnly = input.stale_only !== false; // default true

  let pages;
  try {
    pages = await readAllPages();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Failed to read wiki pages: ${message}`, code: "READ_ERROR" };
  }

  const db = getDb();
  const reembedded: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ page: string; error: string }> = [];

  for (const page of pages) {
    if (staleOnly) {
      const storedHash = getPageContentHash(db, page.name);
      const currentHash = bodyHash(page.body);
      // No stored hash → never embedded (or DB pre-dates hash column) → stale.
      if (storedHash !== null && storedHash === currentHash) {
        skipped.push(page.name);
        continue;
      }
    }

    try {
      await reembedPageBody(db, page.name, page.body);
      reembedded.push(page.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ page: page.name, error: message });
    }
  }

  if (reembedded.length > 0) {
    invalidateIndex();
  }

  return {
    reembedded,
    skipped,
    errors,
    total: pages.length,
  };
}
