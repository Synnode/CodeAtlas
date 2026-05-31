"use strict";
/**
 * wiki-patch.ts
 *
 * MCP tool: wiki_patch
 * Surgical, in-place edit of a single wiki page by exact string replacement —
 * mirrors the host editor's Edit tool. Auto-bumps the `updated:` frontmatter
 * field, re-embeds only the affected chunks, and updates the body hash.
 *
 * Prefer this over wiki_update for small edits to long pages: no re-sending
 * the whole body, lower token cost, lower transcription-error risk.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WikiPatchSchema = void 0;
exports.wikiPatch = wikiPatch;
const zod_1 = require("zod");
const gray_matter_1 = __importDefault(require("gray-matter"));
const wiki_fs_1 = require("../lib/wiki-fs");
const page_embed_1 = require("../lib/page-embed");
const tfidf_1 = require("../lib/tfidf");
const db_1 = require("../db");
exports.WikiPatchSchema = zod_1.z.object({
    page: zod_1.z.string().min(1).describe("Page name without .md extension, e.g. 'AccessManager'"),
    old_string: zod_1.z
        .string()
        .min(1)
        .describe("Exact substring to find in the page body. Must be unique unless replace_all is true."),
    new_string: zod_1.z.string().describe("Replacement text. May be empty to delete the match."),
    replace_all: zod_1.z
        .boolean()
        .optional()
        .describe("If true, replace every occurrence of old_string. Default false; errors if old_string is non-unique."),
});
function todayISO() {
    return new Date().toISOString().slice(0, 10);
}
function countOccurrences(haystack, needle) {
    if (needle.length === 0)
        return 0;
    let count = 0;
    let idx = 0;
    while ((idx = haystack.indexOf(needle, idx)) !== -1) {
        count += 1;
        idx += needle.length;
    }
    return count;
}
async function wikiPatch(input) {
    const { page, old_string, new_string, replace_all } = input;
    if (old_string === new_string) {
        return {
            error: "old_string and new_string are identical — nothing to patch.",
            code: "NO_OP",
        };
    }
    const existing = (0, wiki_fs_1.readPage)(page);
    if (!existing) {
        return {
            error: `Page "${page}" does not exist. Use wiki_update to create it.`,
            code: "PAGE_NOT_FOUND",
        };
    }
    const body = existing.body;
    const matchCount = countOccurrences(body, old_string);
    if (matchCount === 0) {
        return {
            error: `old_string not found in page "${page}".`,
            code: "OLD_STRING_NOT_FOUND",
            match_count: 0,
        };
    }
    if (matchCount > 1 && !replace_all) {
        return {
            error: `old_string is not unique in page "${page}" (${matchCount} matches). Pass replace_all:true or extend old_string with surrounding context to make it unique.`,
            code: "OLD_STRING_NOT_UNIQUE",
            match_count: matchCount,
        };
    }
    // Apply replacement (split/join = exact-string, no regex semantics)
    const newBody = replace_all
        ? body.split(old_string).join(new_string)
        : body.replace(old_string, new_string);
    // Auto-bump updated
    const frontmatter = { ...existing.frontmatter, updated: todayISO() };
    const missing = (0, wiki_fs_1.validateFrontmatter)(frontmatter);
    if (missing.length > 0) {
        return {
            error: `Page frontmatter is missing required fields after patch: ${missing.join(", ")}.`,
            code: "MISSING_FRONTMATTER_FIELDS",
        };
    }
    const newContent = gray_matter_1.default.stringify(newBody, frontmatter);
    let filePath;
    try {
        filePath = (0, wiki_fs_1.writePage)(page, newContent);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: `Failed to write page to disk: ${message}`, code: "WRITE_ERROR" };
    }
    const db = (0, db_1.getDb)();
    let reembed;
    try {
        reembed = await (0, page_embed_1.reembedPageBody)(db, page, newBody);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: `Failed to re-embed page: ${message}`, code: "EMBEDDING_ERROR" };
    }
    (0, tfidf_1.invalidateIndex)();
    return {
        success: true,
        replacements: replace_all ? matchCount : 1,
        chunks_embedded: reembed.embedded,
        chunks_skipped: reembed.skipped,
        path: filePath,
        updated: frontmatter.updated,
    };
}
//# sourceMappingURL=wiki-patch.js.map