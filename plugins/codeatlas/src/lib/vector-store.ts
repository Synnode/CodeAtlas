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

import { existsSync } from "fs";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

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
 * Serializes a float[] to a little-endian Float32 Buffer for sqlite-vec.
 */
function serializeVector(vec: number[]): Buffer {
  const buffer = Buffer.allocUnsafe(vec.length * 4);
  for (let i = 0; i < vec.length; i++) {
    buffer.writeFloatLE(vec[i], i * 4);
  }
  return buffer;
}

function deserializeVector(buffer: Buffer): number[] {
  const result: number[] = [];
  for (let i = 0; i < buffer.length; i += 4) {
    result.push(buffer.readFloatLE(i));
  }
  return result;
}

/**
 * Returns all chunk vectors for a page, including content and embedding.
 * Used for incremental re-embedding (skip unchanged chunks).
 */
export function getChunkVectorsForPage(
  db: DB,
  page: string
): Array<{ chunk_idx: number; content: string; embedding: number[] }> {
  const rows = db
    .prepare(
      `SELECT wc.chunk_idx, wc.content, wv.embedding
       FROM wiki_chunks wc
       JOIN wiki_vectors wv ON wv.rowid = wc.id
       WHERE wc.page = ?
       ORDER BY wc.chunk_idx ASC`
    )
    .all(page) as Array<{ chunk_idx: number; content: string; embedding: Buffer }>;

  return rows.map((r) => ({
    chunk_idx: r.chunk_idx,
    content: r.content,
    embedding: deserializeVector(r.embedding),
  }));
}

/**
 * Reads the stored embedding dimension from an existing DB.
 * Returns null if the DB doesn't exist or has no stored dimension
 * (e.g. pre-1.1 DBs without wiki_meta).
 */
export function getStoredDimension(dbPath: string): number | null {
  if (!existsSync(dbPath)) return null;
  let db: DB | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='wiki_meta'")
      .get();
    if (!tableExists) return null;
    const row = db
      .prepare("SELECT value FROM wiki_meta WHERE key = 'embedding_dim'")
      .get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

/**
 * Initializes the SQLite database and creates tables/virtual tables if needed.
 * embeddingDim is detected at startup from Ollama — not hardcoded.
 */
export function initDb(dbPath: string, embeddingDim: number): DB {
  const db = new Database(dbPath);

  // Load sqlite-vec extension
  sqliteVec.load(db);

  // Enable WAL for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  // Metadata table — stores embedding_dim and other server-side config
  db.exec(`
    CREATE TABLE IF NOT EXISTS wiki_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Store dimension on first creation; no-op on subsequent starts
  db.prepare("INSERT OR IGNORE INTO wiki_meta (key, value) VALUES ('embedding_dim', ?)")
    .run(String(embeddingDim));

  // Create wiki_chunks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS wiki_chunks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      page        TEXT NOT NULL,
      chunk_idx   INTEGER NOT NULL,
      content     TEXT NOT NULL,
      embedded_at TEXT NOT NULL
    );
  `);

  // Create sqlite-vec virtual table — dimension comes from Ollama model info
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS wiki_vectors USING vec0(
      embedding FLOAT[${embeddingDim}]
    );
  `);

  // Per-page content hash for staleness detection.
  // Backwards-compat: existing DBs upgrade in place — pages without a row
  // are treated as stale on first run, then stabilise.
  db.exec(`
    CREATE TABLE IF NOT EXISTS wiki_page_meta (
      page         TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      embedded_at  TEXT NOT NULL
    );
  `);

  return db;
}

/**
 * Stores the body hash for a page. Called after a successful upsertPage so
 * staleness checks can compare against it.
 */
export function setPageContentHash(db: DB, page: string, contentHash: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO wiki_page_meta (page, content_hash, embedded_at)
     VALUES (?, ?, ?)
     ON CONFLICT(page) DO UPDATE SET content_hash = excluded.content_hash,
                                     embedded_at  = excluded.embedded_at`
  ).run(page, contentHash, now);
}

/**
 * Returns the stored body hash for a page, or null if none is recorded
 * (page was never embedded, or DB predates the hash column).
 */
export function getPageContentHash(db: DB, page: string): string | null {
  const row = db
    .prepare("SELECT content_hash FROM wiki_page_meta WHERE page = ?")
    .get(page) as { content_hash: string } | undefined;
  return row?.content_hash ?? null;
}

/**
 * Deletes all chunks, vectors, and meta for a page.
 */
export function deletePageVectors(db: DB, page: string): void {
  const existingIds = db
    .prepare("SELECT id FROM wiki_chunks WHERE page = ?")
    .all(page) as { id: number }[];

  if (existingIds.length > 0) {
    const ids = existingIds.map((r) => BigInt(r.id));
    const placeholders = ids.map(() => "?").join(", ");
    db.prepare(`DELETE FROM wiki_vectors WHERE rowid IN (${placeholders})`).run(...ids);
    db.prepare("DELETE FROM wiki_chunks WHERE page = ?").run(page);
  }
  db.prepare("DELETE FROM wiki_page_meta WHERE page = ?").run(page);
}

/**
 * Renames a page in the chunks + meta tables (vectors stay valid — content unchanged).
 */
export function renamePageVectors(db: DB, oldPage: string, newPage: string): void {
  db.prepare("UPDATE wiki_chunks SET page = ? WHERE page = ?").run(newPage, oldPage);
  db.prepare("UPDATE wiki_page_meta SET page = ? WHERE page = ?").run(newPage, oldPage);
}

/**
 * Upserts all chunk vectors for a page.
 * Deletes existing chunks for the page first (full replacement).
 */
export function upsertPage(
  db: DB,
  page: string,
  chunks: ChunkVector[]
): void {
  const now = new Date().toISOString();

  const upsert = db.transaction(() => {
    // Delete existing chunks and their vectors
    const existingIds = db
      .prepare("SELECT id FROM wiki_chunks WHERE page = ?")
      .all(page) as { id: number }[];

    if (existingIds.length > 0) {
      const ids = existingIds.map((r) => BigInt(r.id));
      const placeholders = ids.map(() => "?").join(", ");

      db.prepare(`DELETE FROM wiki_vectors WHERE rowid IN (${placeholders})`).run(
        ...ids
      );
      db.prepare(`DELETE FROM wiki_chunks WHERE page = ?`).run(page);
    }

    // Insert new chunks
    const insertChunk = db.prepare(
      `INSERT INTO wiki_chunks (page, chunk_idx, content, embedded_at)
       VALUES (?, ?, ?, ?)`
    );
    const insertVector = db.prepare(
      `INSERT INTO wiki_vectors (rowid, embedding) VALUES (?, ?)`
    );

    for (const chunk of chunks) {
      const result = insertChunk.run(
        page,
        chunk.chunk_idx,
        chunk.content,
        now
      );
      const rowid = BigInt(result.lastInsertRowid);
      insertVector.run(rowid, serializeVector(chunk.embedding));
    }
  });

  upsert();
}

/**
 * Performs cosine similarity search using sqlite-vec.
 * Returns top k results sorted by similarity (descending).
 */
export function searchSimilar(
  db: DB,
  queryVec: number[],
  k: number
): SearchResult[] {
  const queryBuffer = serializeVector(queryVec);

  const rows = db
    .prepare(
      `SELECT
         wc.page,
         wc.content,
         wc.chunk_idx,
         wv.rowid,
         wv.distance
       FROM wiki_vectors wv
       JOIN wiki_chunks wc ON wc.id = wv.rowid
       WHERE wv.embedding MATCH ?
         AND k = ?
       ORDER BY wv.distance ASC`
    )
    .all(queryBuffer, k) as Array<{
    page: string;
    content: string;
    chunk_idx: number;
    rowid: number;
    distance: number;
  }>;

  return rows.map((row) => ({
    page: row.page,
    excerpt: row.content,
    score: 1 / (1 + row.distance), // convert distance to similarity score
    chunkIdx: row.chunk_idx,
    rowid: row.rowid,
  }));
}

