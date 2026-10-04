import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { FreshdeskClient } from "../src/client.js";
import { createServer } from "../src/server.js";

async function connect(fetchImpl: typeof fetch) {
  const cfg = { baseUrl: "https://a.freshdesk.com/api/v2", apiKey: "k", maskPii: true, maxRetries: 0 };
  const server = createServer(cfg, new FreshdeskClient(cfg, { fetchImpl, sleep: async () => {} }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("MCP server end-to-end", () => {
  it("exposes only read-only tools", async () => {
    const c = await connect((async () => new Response("[]")) as any);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["get_contact", "get_ticket", "list_contacts", "list_ticket_conversations", "list_tickets", "search_tickets"],
    );
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
  });

  it("returns tool results as JSON text", async () => {
    const c = await connect((async () => new Response(JSON.stringify([{ id: 5, status: 2, priority: 2, subject: "Where is my order" }]))) as any);
    const r: any = await c.callTool({ name: "list_tickets", arguments: {} });
    expect(JSON.parse(r.content[0].text).tickets[0].id).toBe(5);
  });

  it("returns isError with a structured payload on 429", async () => {
    const c = await connect((async () => new Response("{}", { status: 429, headers: { "retry-after": "12" } })) as any);
    const r: any = await c.callTool({ name: "list_tickets", arguments: {} });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0].text)).toMatchObject({ error: "rate_limited", retry_after_seconds: 12 });
  });

  it("rejects invalid arguments", async () => {
    const c = await connect((async () => new Response("[]")) as any);
    const r: any = await c.callTool({ name: "get_ticket", arguments: { ticket_id: -1 } }).catch((e) => ({ isError: true, e }));
    expect(r.isError).toBe(true);
  });
});
