import { describe, expect, it, vi } from "vitest";
import { redact } from "../src/format.js";
import { tools } from "../src/tools/index.js";

const tool = (n: string) => tools.find((t) => t.name === n)!;
const run = (n: string, args: object, get: any, maskPii = true) => {
  const t = tool(n);
  return t.handler(t.schema.parse(args), { client: { get } as any, maskPii });
};

describe("search_tickets", () => {
  it("builds a quoted AND query from structured filters", async () => {
    const get = vi.fn(async () => ({ results: [], total: 0 }));
    await run("search_tickets", { status: "open", priority: "high", tag: "refund" }, get);
    expect(get).toHaveBeenCalledWith("/search/tickets", {
      query: `"status:2 AND priority:3 AND tag:'refund'"`,
      page: 1,
    });
  });

  it("strips quotes from free-text values to prevent query injection", async () => {
    const get = vi.fn(async () => ({ results: [], total: 0 }));
    await run("search_tickets", { tag: `x' OR status:5 "` }, get);
    expect((get.mock.calls[0] as any)[1].query).toBe(`"tag:'x OR status:5 '"`);
  });

  it("requires at least one filter", async () => {
    await expect(run("search_tickets", {}, vi.fn())).rejects.toThrow(/at least one/);
  });

  it("rejects page > 10 (Freshdesk limit)", () => {
    expect(() => tool("search_tickets").schema.parse({ status: "open", page: 11 })).toThrow();
  });

  it("reports has_more from total", async () => {
    const get = vi.fn(async () => ({ results: [{ id: 1, status: 2, priority: 1 }], total: 45 }));
    const r: any = await run("search_tickets", { status: "open" }, get);
    expect(r.has_more).toBe(true);
    expect(r.tickets[0].status).toBe("open");
  });
});

describe("list/get tickets", () => {
  it("maps status/priority labels and sets has_more by page fullness", async () => {
    const rows = [{ id: 1, status: 3, priority: 4, subject: "Hi" }];
    const r: any = await run("list_tickets", { per_page: 1 }, vi.fn(async () => rows));
    expect(r.tickets[0]).toMatchObject({ id: 1, status: "pending", priority: "urgent" });
    expect(r.has_more).toBe(true);
  });

  it("get_ticket requests conversations only when asked", async () => {
    const get = vi.fn(async () => ({ id: 9, status: 2, priority: 1, conversations: [{ id: 1, incoming: true, body_text: "hello" }] }));
    const r: any = await run("get_ticket", { ticket_id: 9, include_conversations: true }, get);
    expect(get).toHaveBeenCalledWith("/tickets/9", { include: "conversations" });
    expect(r.conversations[0]).toMatchObject({ from: "customer", body: "hello" });
  });
});

describe("redact", () => {
  it("masks emails and phone numbers when enabled", () => {
    expect(redact("mail a.b@x.com or call +1 (555) 123-4567", true)).toBe("mail [email] or call [phone]");
  });
  it("leaves text alone when disabled but still truncates", () => {
    expect(redact("a@b.com", false)).toBe("a@b.com");
    expect(redact("x".repeat(50), false, 10)).toMatch(/truncated/);
  });
});
