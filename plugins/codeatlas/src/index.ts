/**
 * index.ts
 *
 * MCP server entrypoint for wiki-mcp.
 * Registers all 5 wiki tools and starts the stdio transport.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return z.toJSONSchema(schema, { reused: "inline" }) as Record<string, unknown>;
}

// Config is loaded (and validated) at import time — exits if required vars missing
import { config } from "./config";

// Tool handlers
import { wikiGet, WikiGetSchema } from "./tools/wiki-get";
import { wikiSearch, WikiSearchSchema } from "./tools/wiki-search";
import { wikiUpdate, WikiUpdateSchema } from "./tools/wiki-update";
import { wikiPatch, WikiPatchSchema } from "./tools/wiki-patch";
import { wikiIngest, WikiIngestSchema, WikiIngestBaseSchema } from "./tools/wiki-ingest";
import { wikiLint, WikiLintSchema } from "./tools/wiki-lint";
import { wikiReembedAll, WikiReembedAllSchema } from "./tools/wiki-reembed-all";
import { wikiDelete, WikiDeleteSchema } from "./tools/wiki-delete";
import { wikiRename, WikiRenameSchema } from "./tools/wiki-rename";
import { wikiContextFor, WikiContextForSchema } from "./tools/wiki-context-for";
import { wikiList, WikiListSchema } from "./tools/wiki-list";

// Initialize DB at startup so errors surface early
import { initializeDb, getDb } from "./db";


async function main(): Promise<void> {
  // Initialize DB (detects embedding dim from Ollama if needed)
  try {
    await initializeDb();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[wiki-mcp] Failed to initialize database at "${config.dbPath}": ${message}`);
    process.exit(1);
  }

  const server = new Server(
    {
      name: "wiki-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // --- List tools handler ---
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "wiki_get",
          description:
            "Fetch a single wiki page by name. Returns the full markdown content including frontmatter.",
          inputSchema: zodToJsonSchema(WikiGetSchema),
        },
        {
          name: "wiki_search",
          description:
            "Search the wiki using hybrid semantic + keyword search (TF-IDF). Returns ranked results with excerpts.",
          inputSchema: zodToJsonSchema(WikiSearchSchema),
        },
        {
          name: "wiki_update",
          description:
            "Create a new wiki page or update an existing one. Validates frontmatter, writes to disk, and re-embeds the page in the vector store.",
          inputSchema: zodToJsonSchema(WikiUpdateSchema),
        },
        {
          name: "wiki_patch",
          description:
            "Surgical, in-place edit of an existing wiki page by exact string replacement (like the host Edit tool). Auto-bumps 'updated' to today, re-embeds only affected chunks. Prefer over wiki_update for small edits to long pages — avoids re-sending the full body. Errors if old_string is absent, or non-unique unless replace_all is true.",
          inputSchema: zodToJsonSchema(WikiPatchSchema),
        },
        {
          name: "wiki_ingest",
          description:
            "Process raw sources into wiki pages using Claude. Pass 'file'/'files' for local files from RAW_ROOT, or 'url'/'urls' to fetch from a web page or GitHub file URL directly. Sources can be mixed. Raw files are not deleted.",
          inputSchema: zodToJsonSchema(WikiIngestBaseSchema),
        },
        {
          name: "wiki_lint",
          description:
            "Run a health check on the entire wiki. Finds broken links (with fuzzy suggestions), orphan pages, missing frontmatter, stale embeddings, and missing concepts. Pass fix:true to auto-fix missing 'updated' dates.",
          inputSchema: zodToJsonSchema(WikiLintSchema),
        },
        {
          name: "wiki_reembed_all",
          description:
            "Re-embed wiki pages in the vector store. By default only re-embeds stale pages (updated date newer than last embed). Pass stale_only:false to force re-embed all pages.",
          inputSchema: zodToJsonSchema(WikiReembedAllSchema),
        },
        {
          name: "wiki_delete",
          description:
            "Delete a wiki page and remove its vectors from the database.",
          inputSchema: zodToJsonSchema(WikiDeleteSchema),
        },
        {
          name: "wiki_rename",
          description:
            "Rename a wiki page and atomically rewrite all [[links]] pointing to it across every page in the wiki.",
          inputSchema: zodToJsonSchema(WikiRenameSchema),
        },
        {
          name: "wiki_list",
          description:
            "List all wiki pages with their title, tags, and updated date. Optionally filter by tags.",
          inputSchema: zodToJsonSchema(WikiListSchema),
        },
        {
          name: "wiki_context_for",
          description:
            "Given a source file path, extracts the filename and symbols (classes, functions, types) and returns the most relevant wiki pages. Use this when opening a file to automatically load relevant context without manually guessing search terms.",
          inputSchema: zodToJsonSchema(WikiContextForSchema),
        },
      ],
    };
  });

  // --- Call tool handler ---
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "wiki_get": {
          const input = WikiGetSchema.parse(args);
          const result = await wikiGet(input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "wiki_search": {
          const input = WikiSearchSchema.parse(args);
          const result = await wikiSearch(input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "wiki_update": {
          const input = WikiUpdateSchema.parse(args);
          const result = await wikiUpdate(input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "wiki_patch": {
          const input = WikiPatchSchema.parse(args);
          const result = await wikiPatch(input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "wiki_ingest": {
          const input = WikiIngestSchema.parse(args);
          const result = await wikiIngest(input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "wiki_lint": {
          const input = WikiLintSchema.parse(args);
          const result = await wikiLint(input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "wiki_reembed_all": {
          const input = WikiReembedAllSchema.parse(args);
          const result = await wikiReembedAll(input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "wiki_delete": {
          const input = WikiDeleteSchema.parse(args);
          const result = await wikiDelete(input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "wiki_rename": {
          const input = WikiRenameSchema.parse(args);
          const result = await wikiRename(input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "wiki_list": {
          const input = WikiListSchema.parse(args);
          const result = await wikiList(input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "wiki_context_for": {
          const input = WikiContextForSchema.parse(args);
          const result = await wikiContextFor(input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        default:
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: `Unknown tool: ${name}`, code: "UNKNOWN_TOOL" }),
              },
            ],
            isError: true,
          };
      }
    } catch (err) {
      // Handle Zod validation errors
      if (err instanceof z.ZodError) {
        const issues = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: `Invalid tool arguments: ${issues}`,
                code: "VALIDATION_ERROR",
              }),
            },
          ],
          isError: true,
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Internal server error: ${message}`, code: "INTERNAL_ERROR" }),
          },
        ],
        isError: true,
      };
    }
  });

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't pollute the MCP stdio channel
  console.error(
    `[wiki-mcp] Server started. WIKI_ROOT=${config.wikiRoot}, OLLAMA_URL=${config.ollamaUrl}`
  );
}

main().catch((err) => {
  console.error(`[wiki-mcp] Fatal error:`, err);
  process.exit(1);
});
