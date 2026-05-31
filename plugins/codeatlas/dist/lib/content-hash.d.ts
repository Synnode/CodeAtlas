/**
 * content-hash.ts
 *
 * Body-only SHA-256 hash used as the source of truth for embedding staleness.
 * Frontmatter is intentionally excluded so that an `updated:` bump alone does
 * not invalidate cached embeddings.
 */
export declare function bodyHash(body: string): string;
//# sourceMappingURL=content-hash.d.ts.map