import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FreshdeskClient, FreshdeskError } from "./client.js";
import type { Config } from "./config.js";
import { tools } from "./tools/index.js";

export function createServer(cfg: Config, client = new FreshdeskClient(cfg)): McpServer {
  const server = new McpServer({ name: "freshdesk-mcp", version: "1.0.0" });
  for (const t of tools) {
    server.registerTool(
      t.name,
      {
        description: t.description,
        inputSchema: t.schema.shape,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      async (args: z.infer<typeof t.schema>) => {
        try {
          const result = await t.handler(args, { client, maskPii: cfg.maskPii });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(toErrorPayload(e)) }] };
        }
      },
    );
  }
  return server;
}

export function toErrorPayload(e: unknown) {
  if (e instanceof FreshdeskError) {
    return {
      error: e.code,
      message: e.message,
      ...(e.retryAfterSeconds !== undefined ? { retry_after_seconds: e.retryAfterSeconds } : {}),
    };
  }
  return { error: "invalid_request", message: (e as Error).message };
}
