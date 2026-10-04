import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FreshdeskClient } from "../src/client.js";
import { startMock } from "../mock/server.js";
import { tools } from "../src/tools/index.js";

let stop: () => void;
let url: string;
beforeAll(async () => {
  const m = await startMock(0, { rateLimitEvery: 4 });
  url = m.url;
  stop = () => m.server.close();
});
afterAll(() => stop());

const mk = (apiKey = "demo", maxRetries = 3) =>
  new FreshdeskClient({ baseUrl: url, apiKey, maxRetries }, { sleep: async () => {} });
const call = (client: FreshdeskClient, n: string, a: object) => {
  const t = tools.find((x) => x.name === n)!;
  return t.handler(t.schema.parse(a), { client, maskPii: true }) as Promise<any>;
};

describe("tools against the mock server (real HTTP)", () => {
  it("lists, gets, searches and masks PII, surviving injected 429s", async () => {
    const c = mk();
    const list = await call(c, "list_tickets", { per_page: 5 });
    expect(list.tickets).toHaveLength(5);
    const got = await call(c, "get_ticket", { ticket_id: 1001, include_conversations: true });
    expect(got.ticket.description).not.toMatch(/@example\.com|555/);
    expect(got.conversations).toHaveLength(3);
    const s = await call(c, "search_tickets", { status: "open", tag: "refund" });
    expect(s.total).toBeGreaterThan(0);
    expect(s.tickets.every((t: any) => t.status === "open")).toBe(true);
    const contact = await call(c, "get_contact", { contact_id: 5000 });
    expect(contact.contact.email).toBe("[email]");
  });

  it("maps 404 and 401", async () => {
    await expect(call(mk(), "get_ticket", { ticket_id: 99999 })).rejects.toMatchObject({ code: "not_found" });
    await expect(call(mk("bad-key"), "list_tickets", {})).rejects.toMatchObject({ code: "auth_failed" });
  });

  it("surfaces rate_limited when retries are disabled", async () => {
    const c = mk("demo", 0);
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => call(c, "list_contacts", {})));
    expect(results.some((r) => r.status === "rejected" && (r.reason as any).code === "rate_limited")).toBe(true);
  });
});
