#!/usr/bin/env node
import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FreshdeskClient } from "./client.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

async function main() {
  const cfg = loadConfig();
  const client = new FreshdeskClient(cfg);

  // Fail fast on bad credentials instead of at the agent's first tool call.
  await client.get("/tickets", { per_page: 1 });

  await createServer(cfg, client).connect(new StdioServerTransport());
  console.error("freshdesk-mcp ready (stdio, read-only)"); // stderr: stdout is the MCP channel
}

main().catch((e) => {
  console.error(`freshdesk-mcp failed to start: ${(e as Error).message}`);
  process.exit(1);
});
