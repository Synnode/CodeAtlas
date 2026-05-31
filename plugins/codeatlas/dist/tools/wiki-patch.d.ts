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
import { z } from "zod";
export declare const WikiPatchSchema: z.ZodObject<{
    page: z.ZodString;
    old_string: z.ZodString;
    new_string: z.ZodString;
    replace_all: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type WikiPatchInput = z.infer<typeof WikiPatchSchema>;
export interface WikiPatchSuccess {
    success: true;
    replacements: number;
    chunks_embedded: number;
    chunks_skipped: number;
    path: string;
    updated: string;
}
export interface WikiPatchError {
    error: string;
    code: string;
    match_count?: number;
}
export type WikiPatchResult = WikiPatchSuccess | WikiPatchError;
export declare function wikiPatch(input: WikiPatchInput): Promise<WikiPatchResult>;
//# sourceMappingURL=wiki-patch.d.ts.map