"use strict";
/**
 * wiki-update.ts
 *
 * MCP tool: wiki_update
 * Creates or updates a wiki page, re-embeds it in the vector store,
 * and invalidates the TF-IDF index.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WikiUpdateSchema = void 0;
exports.wikiUpdate = wikiUpdate;
const zod_1 = require("zod");
const child_process_1 = require("child_process");
const gray_matter_1 = __importDefault(require("gray-matter"));
const wiki_fs_1 = require("../lib/wiki-fs");
const page_embed_1 = require("../lib/page-embed");
const tfidf_1 = require("../lib/tfidf");
const db_1 = require("../db");
exports.WikiUpdateSchema = zod_1.z.object({
    page: zod_1.z.string().min(1).describe("Page name without .md extension, e.g. 'AccessManager'"),
    content: zod_1.z.string().min(1).describe("Full markdown content including YAML frontmatter"),
    reason: zod_1.z.string().optional().describe("Brief description of why this page was updated"),
    dry_run: zod_1.z.boolean().optional().describe("If true, validate and diff without writing to disk or re-embedding"),
    git_commit: zod_1.z.boolean().optional().describe("If true, run git add + git commit after writing the page"),
});
function diffLines(oldText, newText) {
    const count = (text) => {
        const map = new Map();
        for (const line of text.split("\n"))
            map.set(line, (map.get(line) ?? 0) + 1);
        return map;
    };
    const oldCounts = count(oldText);
    const newCounts = count(newText);
    let added = 0;
    let removed = 0;
    for (const [line, n] of newCounts)
        added += Math.max(0, n - (oldCounts.get(line) ?? 0));
    for (const [line, n] of oldCounts)
        removed += Math.max(0, n - (newCounts.get(line) ?? 0));
    return { added, removed };
}
/**
 * Handles the wiki_update tool call.
 */
async function wikiUpdate(input) {
    const { page, content, dry_run, git_commit } = input;
    // Parse and validate frontmatter
    let parsed;
    try {
        parsed = (0, gray_matter_1.default)(content);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            error: `Failed to parse frontmatter: ${message}`,
            code: "INVALID_FRONTMATTER",
        };
    }
    const missing = (0, wiki_fs_1.validateFrontmatter)(parsed.data);
    if (missing.length > 0) {
        return {
            error: `Page frontmatter is missing required fields: ${missing.join(", ")}. All wiki pages must have "title", "tags", and "updated" fields.`,
            code: "MISSING_FRONTMATTER_FIELDS",
        };
    }
    const referencedLinks = (0, wiki_fs_1.extractWikiLinks)(parsed.content);
    const missingLinks = referencedLinks.filter((link) => !(0, wiki_fs_1.pageExists)(link));
    if (dry_run) {
        const existing = (0, wiki_fs_1.readPage)(page);
        const oldContent = existing?.content ?? null;
        return {
            dry_run: true,
            page,
            is_new: !existing,
            old_content: oldContent,
            new_content: content,
            line_changes: oldContent ? diffLines(oldContent, content) : { added: content.split("\n").length, removed: 0 },
            ...(missingLinks.length > 0 ? { missing_links: missingLinks } : {}),
        };
    }
    // Capture existence before writing so the git commit message can pick the right verb
    const pagePreexisted = (0, wiki_fs_1.pageExists)(page);
    // Write page to disk
    let filePath;
    try {
        filePath = (0, wiki_fs_1.writePage)(page, content);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            error: `Failed to write page to disk: ${message}`,
            code: "WRITE_ERROR",
        };
    }
    // Re-embed (incremental) + write content hash
    const db = (0, db_1.getDb)();
    let reembed;
    try {
        reembed = await (0, page_embed_1.reembedPageBody)(db, page, parsed.content);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            error: `Failed to re-embed page: ${message}`,
            code: "EMBEDDING_ERROR",
        };
    }
    // Invalidate TF-IDF index so it's rebuilt on next search
    (0, tfidf_1.invalidateIndex)();
    // Optional git commit
    let gitCommitted;
    if (git_commit) {
        try {
            (0, child_process_1.execFileSync)("git", ["add", filePath], { stdio: "pipe" });
            const verb = pagePreexisted ? "update" : "create";
            (0, child_process_1.execFileSync)("git", ["commit", "-m", `wiki: ${verb} ${page}`], { stdio: "pipe" });
            gitCommitted = true;
        }
        catch {
            gitCommitted = false;
        }
    }
    return {
        success: true,
        chunks_embedded: reembed.embedded,
        chunks_skipped: reembed.skipped,
        path: filePath,
        ...(gitCommitted !== undefined ? { git_committed: gitCommitted } : {}),
        ...(missingLinks.length > 0 ? { missing_links: missingLinks } : {}),
    };
}
//# sourceMappingURL=wiki-update.js.map