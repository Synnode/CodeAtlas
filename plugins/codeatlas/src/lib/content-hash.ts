/**
 * content-hash.ts
 *
 * Body-only SHA-256 hash used as the source of truth for embedding staleness.
 * Frontmatter is intentionally excluded so that an `updated:` bump alone does
 * not invalidate cached embeddings.
 */

import { createHash } from "crypto";

export function bodyHash(body: string): string {
  return createHash("sha256").update(body, "utf-8").digest("hex");
}
