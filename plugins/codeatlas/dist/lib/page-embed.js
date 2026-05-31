"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.reembedPageBody = reembedPageBody;
const chunker_1 = require("./chunker");
const embedder_1 = require("./embedder");
const vector_store_1 = require("./vector-store");
const content_hash_1 = require("./content-hash");
/**
 * Re-embeds a page's body incrementally and stores the new content hash.
 * Throws on embedding/db failure — callers translate to tool errors.
 */
async function reembedPageBody(db, page, body) {
    const chunks = (0, chunker_1.chunkPage)(page, body);
    const existingVectors = (0, vector_store_1.getChunkVectorsForPage)(db, page);
    const existingByIdx = new Map(existingVectors.map((v) => [v.chunk_idx, v]));
    const toEmbed = [];
    const recycled = [];
    for (const chunk of chunks) {
        const existing = existingByIdx.get(chunk.chunk_idx);
        if (existing && existing.content === chunk.content) {
            recycled.push({
                chunk_idx: chunk.chunk_idx,
                content: chunk.content,
                embedding: existing.embedding,
            });
        }
        else {
            toEmbed.push(chunk);
        }
    }
    let newEmbeddings = [];
    if (toEmbed.length > 0) {
        newEmbeddings = await (0, embedder_1.embedBatch)(toEmbed.map((c) => c.content));
    }
    const freshVectors = toEmbed.map((chunk, i) => ({
        chunk_idx: chunk.chunk_idx,
        content: chunk.content,
        embedding: newEmbeddings[i],
    }));
    const allVectors = [...recycled, ...freshVectors].sort((a, b) => a.chunk_idx - b.chunk_idx);
    (0, vector_store_1.upsertPage)(db, page, allVectors);
    (0, vector_store_1.setPageContentHash)(db, page, (0, content_hash_1.bodyHash)(body));
    return { embedded: toEmbed.length, skipped: recycled.length };
}
//# sourceMappingURL=page-embed.js.map