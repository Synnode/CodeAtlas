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

import { chunkPage } from "./chunker";
import { embedBatch } from "./embedder";
import {
  upsertPage,
  ChunkVector,
  getChunkVectorsForPage,
  setPageContentHash,
  DB,
} from "./vector-store";
import { bodyHash } from "./content-hash";

export interface ReembedResult {
  embedded: number;
  skipped: number;
}

/**
 * Re-embeds a page's body incrementally and stores the new content hash.
 * Throws on embedding/db failure — callers translate to tool errors.
 */
export async function reembedPageBody(
  db: DB,
  page: string,
  body: string
): Promise<ReembedResult> {
  const chunks = chunkPage(page, body);

  const existingVectors = getChunkVectorsForPage(db, page);
  const existingByIdx = new Map(existingVectors.map((v) => [v.chunk_idx, v]));

  const toEmbed: typeof chunks = [];
  const recycled: ChunkVector[] = [];

  for (const chunk of chunks) {
    const existing = existingByIdx.get(chunk.chunk_idx);
    if (existing && existing.content === chunk.content) {
      recycled.push({
        chunk_idx: chunk.chunk_idx,
        content: chunk.content,
        embedding: existing.embedding,
      });
    } else {
      toEmbed.push(chunk);
    }
  }

  let newEmbeddings: number[][] = [];
  if (toEmbed.length > 0) {
    newEmbeddings = await embedBatch(toEmbed.map((c) => c.content));
  }

  const freshVectors: ChunkVector[] = toEmbed.map((chunk, i) => ({
    chunk_idx: chunk.chunk_idx,
    content: chunk.content,
    embedding: newEmbeddings[i],
  }));

  const allVectors = [...recycled, ...freshVectors].sort(
    (a, b) => a.chunk_idx - b.chunk_idx
  );

  upsertPage(db, page, allVectors);
  setPageContentHash(db, page, bodyHash(body));

  return { embedded: toEmbed.length, skipped: recycled.length };
}
