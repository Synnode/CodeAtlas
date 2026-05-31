"use strict";
/**
 * wiki-lint.ts
 *
 * MCP tool: wiki_lint
 * Runs a health check on the entire wiki and returns a structured report.
 *
 * Checks:
 *   1. Broken links — [[PageName]] refs where PageName.md does not exist
 *   2. Orphan pages — pages with no incoming links
 *   3. Missing frontmatter — pages lacking title, tags, or updated
 *   4. Stale embeddings — pages whose frontmatter updated > last embed time
 *   5. Missing concepts — capitalized noun phrases appearing 3+ times without a dedicated page
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WikiLintSchema = void 0;
exports.wikiLint = wikiLint;
const zod_1 = require("zod");
const gray_matter_1 = __importDefault(require("gray-matter"));
const fs = __importStar(require("fs"));
const wiki_fs_1 = require("../lib/wiki-fs");
const vector_store_1 = require("../lib/vector-store");
const content_hash_1 = require("../lib/content-hash");
const db_1 = require("../db");
exports.WikiLintSchema = zod_1.z.object({
    fix: zod_1.z
        .boolean()
        .optional()
        .describe("If true, auto-fix missing 'updated' frontmatter dates in place"),
});
function editDistance(a, b) {
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] =
                a[i - 1] === b[j - 1]
                    ? dp[i - 1][j - 1]
                    : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[m][n];
}
function findClosestPage(link, pageNames) {
    if (pageNames.length === 0)
        return null;
    const linkLower = link.toLowerCase();
    let best = null;
    let bestDist = Infinity;
    for (const name of pageNames) {
        const dist = editDistance(linkLower, name.toLowerCase());
        const maxLen = Math.max(link.length, name.length);
        if (dist < bestDist && dist / maxLen < 0.4) {
            bestDist = dist;
            best = name;
        }
    }
    return best;
}
/**
 * Extracts capitalized noun phrases (2+ word sequences or single capitalized words)
 * that look like concept names from text.
 */
function extractConceptCandidates(text) {
    const candidates = [];
    // Only multi-word Title Case phrases — avoids false positives from single
    // PascalCase code identifiers (DoorController, AudioSource, etc.)
    const phraseRegex = /(?<!\[\[)\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b(?!\]\])/g;
    let match;
    while ((match = phraseRegex.exec(text)) !== null) {
        candidates.push(match[1]);
    }
    return candidates;
}
/**
 * Handles the wiki_lint tool call.
 */
async function wikiLint(input = {}) {
    const { fix } = input;
    let pages;
    try {
        pages = await (0, wiki_fs_1.readAllPages)();
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            error: `Failed to read wiki pages: ${message}`,
            code: "READ_ERROR",
        };
    }
    const pageNames = new Set(pages.map((p) => p.name));
    const pageNameList = [...pageNames];
    const db = (0, db_1.getDb)();
    const brokenLinks = [];
    const referencedPages = new Set();
    const missingFrontmatter = [];
    const staleEmbeddings = [];
    const conceptFrequency = new Map();
    const fixed = [];
    const today = new Date().toISOString().split("T")[0];
    for (const page of pages) {
        const links = (0, wiki_fs_1.extractWikiLinks)(page.content);
        for (const link of links) {
            referencedPages.add(link);
            if (!pageNames.has(link)) {
                brokenLinks.push({ page: page.name, link, suggestion: findClosestPage(link, pageNameList) });
            }
        }
        const fm = page.frontmatter;
        const missing = [];
        if (!fm["title"])
            missing.push("title");
        if (!fm["tags"])
            missing.push("tags");
        if (!fm["updated"])
            missing.push("updated");
        // Auto-fix: write missing 'updated' date into frontmatter
        if (fix && !fm["updated"]) {
            try {
                const parsed = (0, gray_matter_1.default)(page.content);
                parsed.data["updated"] = today;
                const newContent = gray_matter_1.default.stringify(parsed.content, parsed.data);
                fs.writeFileSync((0, wiki_fs_1.resolvePage)(page.name), newContent, "utf-8");
                fixed.push({ page: page.name, field: "updated", value: today });
                missing.splice(missing.indexOf("updated"), 1);
            }
            catch {
                // non-fatal
            }
        }
        if (missing.length > 0) {
            missingFrontmatter.push({ page: page.name, missing });
        }
        const storedHash = (0, vector_store_1.getPageContentHash)(db, page.name);
        if (storedHash === null || storedHash !== (0, content_hash_1.bodyHash)(page.body)) {
            staleEmbeddings.push(page.name);
        }
        const candidates = extractConceptCandidates(page.body);
        for (const candidate of candidates) {
            conceptFrequency.set(candidate, (conceptFrequency.get(candidate) ?? 0) + 1);
        }
    }
    const orphanPages = pages
        .filter((p) => !referencedPages.has(p.name))
        .map((p) => p.name);
    const missingConcepts = [];
    for (const [concept, count] of conceptFrequency.entries()) {
        if (count >= 3 && !pageNames.has(concept)) {
            missingConcepts.push(concept);
        }
    }
    missingConcepts.sort();
    return {
        broken_links: brokenLinks,
        orphan_pages: orphanPages,
        missing_frontmatter: missingFrontmatter,
        stale_embeddings: staleEmbeddings,
        missing_concepts: missingConcepts,
        ...(fixed.length > 0 ? { fixed } : {}),
    };
}
//# sourceMappingURL=wiki-lint.js.map