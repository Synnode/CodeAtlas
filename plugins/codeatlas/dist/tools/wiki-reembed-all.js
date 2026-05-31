"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WikiReembedAllSchema = void 0;
exports.wikiReembedAll = wikiReembedAll;
const zod_1 = require("zod");
const wiki_fs_1 = require("../lib/wiki-fs");
const vector_store_1 = require("../lib/vector-store");
const content_hash_1 = require("../lib/content-hash");
const page_embed_1 = require("../lib/page-embed");
const tfidf_1 = require("../lib/tfidf");
const db_1 = require("../db");
exports.WikiReembedAllSchema = zod_1.z.object({
    stale_only: zod_1.z
        .boolean()
        .optional()
        .describe("If true (default), only re-embed pages whose body hash differs from the stored hash. If false, re-embed all pages."),
});
async function wikiReembedAll(input) {
    const staleOnly = input.stale_only !== false; // default true
    let pages;
    try {
        pages = await (0, wiki_fs_1.readAllPages)();
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: `Failed to read wiki pages: ${message}`, code: "READ_ERROR" };
    }
    const db = (0, db_1.getDb)();
    const reembedded = [];
    const skipped = [];
    const errors = [];
    for (const page of pages) {
        if (staleOnly) {
            const storedHash = (0, vector_store_1.getPageContentHash)(db, page.name);
            const currentHash = (0, content_hash_1.bodyHash)(page.body);
            // No stored hash → never embedded (or DB pre-dates hash column) → stale.
            if (storedHash !== null && storedHash === currentHash) {
                skipped.push(page.name);
                continue;
            }
        }
        try {
            await (0, page_embed_1.reembedPageBody)(db, page.name, page.body);
            reembedded.push(page.name);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            errors.push({ page: page.name, error: message });
        }
    }
    if (reembedded.length > 0) {
        (0, tfidf_1.invalidateIndex)();
    }
    return {
        reembedded,
        skipped,
        errors,
        total: pages.length,
    };
}
//# sourceMappingURL=wiki-reembed-all.js.map