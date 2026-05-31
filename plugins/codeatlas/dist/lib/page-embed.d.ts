/**
 * page-embed.ts
 *
 * Shared incremental re-embedding for a single page. Used by wiki_update,
 * wiki_patch, and wiki_reembed_all so that all writers go through the same
 * codepath:
 *   1. Chunk the body
 *   2. Reuse existing vectors for unchanged chunks (by chunk_idx + content)
 *   3. Embed only the changed/new chunks
 *   4. Upsert the full chunk set for the page
 *   5. Record the body hash for hash-based staleness detection
 */
import { DB } from "./vector-store";
export interface ReembedResult {
    embedded: number;
    skipped: number;
}
/**
 * Re-embeds a page's body incrementally and stores the new content hash.
 * Throws on embedding/db failure — callers translate to tool errors.
 */
export declare function reembedPageBody(db: DB, page: string, body: string): Promise<ReembedResult>;
//# sourceMappingURL=page-embed.d.ts.map