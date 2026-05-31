/**
 * vector-store.ts
 *
 * Wraps better-sqlite3 + sqlite-vec for vector storage and similarity search.
 *
 * Schema:
 *   wiki_meta(key, value)            — server metadata (embedding_dim, etc.)
 *   wiki_chunks(id, page, chunk_idx, content, embedded_at)
 *   wiki_vectors USING vec0(embedding FLOAT[N])  — N detected from Ollama
 *   wiki_page_meta(page, content_hash, embedded_at) — per-page body hash for
 *     hash-based staleness detection (replaces the old date-comparison heuristic)
 *
 * wiki_chunks.rowid maps 1:1 to wiki_vectors.rowid.
 */
import Database from "better-sqlite3";
export type DB = Database.Database;
export interface ChunkVector {
    chunk_idx: number;
    content: string;
    embedding: number[];
}
export interface SearchResult {
    page: string;
    excerpt: string;
    score: number;
    chunkIdx: number;
    rowid: number;
}
/**
 * Returns all chunk vectors for a page, including content and embedding.
 * Used for incremental re-embedding (skip unchanged chunks).
 */
export declare function getChunkVectorsForPage(db: DB, page: string): Array<{
    chunk_idx: number;
    content: string;
    embedding: number[];
}>;
/**
 * Reads the stored embedding dimension from an existing DB.
 * Returns null if the DB doesn't exist or has no stored dimension
 * (e.g. pre-1.1 DBs without wiki_meta).
 */
export declare function getStoredDimension(dbPath: string): number | null;
/**
 * Initializes the SQLite database and creates tables/virtual tables if needed.
 * embeddingDim is detected at startup from Ollama — not hardcoded.
 */
export declare function initDb(dbPath: string, embeddingDim: number): DB;
/**
 * Stores the body hash for a page. Called after a successful upsertPage so
 * staleness checks can compare against it.
 */
export declare function setPageContentHash(db: DB, page: string, contentHash: string): void;
/**
 * Returns the stored body hash for a page, or null if none is recorded
 * (page was never embedded, or DB predates the hash column).
 */
export declare function getPageContentHash(db: DB, page: string): string | null;
/**
 * Deletes all chunks, vectors, and meta for a page.
 */
export declare function deletePageVectors(db: DB, page: string): void;
/**
 * Renames a page in the chunks + meta tables (vectors stay valid — content unchanged).
 */
export declare function renamePageVectors(db: DB, oldPage: string, newPage: string): void;
/**
 * Upserts all chunk vectors for a page.
 * Deletes existing chunks for the page first (full replacement).
 */
export declare function upsertPage(db: DB, page: string, chunks: ChunkVector[]): void;
/**
 * Performs cosine similarity search using sqlite-vec.
 * Returns top k results sorted by similarity (descending).
 */
export declare function searchSimilar(db: DB, queryVec: number[], k: number): SearchResult[];
//# sourceMappingURL=vector-store.d.ts.map