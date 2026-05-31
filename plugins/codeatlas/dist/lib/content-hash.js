"use strict";
/**
 * content-hash.ts
 *
 * Body-only SHA-256 hash used as the source of truth for embedding staleness.
 * Frontmatter is intentionally excluded so that an `updated:` bump alone does
 * not invalidate cached embeddings.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.bodyHash = bodyHash;
const crypto_1 = require("crypto");
function bodyHash(body) {
    return (0, crypto_1.createHash)("sha256").update(body, "utf-8").digest("hex");
}
//# sourceMappingURL=content-hash.js.map