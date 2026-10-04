import { describe, expect, it, vi } from "vitest";
import { FreshdeskClient, FreshdeskError } from "../src/client.js";

const cfg = { baseUrl: "https://acme.freshdesk.com/api/v2", apiKey: "k", maxRetries: 3 };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

function make(responses: Response[]) {
  const fetchImpl = vi.fn(async () => responses.shift()!);
  const sleep = vi.fn(async () => {});
  return { client: new FreshdeskClient(cfg, { fetchImpl: fetchImpl as any, sleep, random: () => 1 }), fetchImpl, sleep };
}

describe("FreshdeskClient", () => {
  it("sends Basic auth built from the API key", async () => {
    const { client, fetchImpl } = make([json([])]);
    await client.get("/tickets", { per_page: 1 });
    const [url, init] = fetchImpl.mock.calls[0] as any;
    expect(String(url)).toBe("https://acme.freshdesk.com/api/v2/tickets?per_page=1");
    expect(init.headers.Authorization).toBe("Basic " + Buffer.from("k:X").toString("base64"));
  });

  it("honors Retry-After on 429 then succeeds", async () => {
    const { client, sleep } = make([json({}, 429, { "retry-after": "7" }), json({ ok: 1 })]);
    await expect(client.get("/tickets")).resolves.toEqual({ ok: 1 });
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it("returns a structured rate_limited error when retries are exhausted", async () => {
    const { client } = make(Array.from({ length: 4 }, () => json({}, 429, { "retry-after": "5" })));
    await expect(client.get("/tickets")).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 5 });
  });

  it("does not wait longer than the cap; surfaces retry_after instead", async () => {
    const { client, sleep } = make([json({}, 429, { "retry-after": "600" })]);
    await expect(client.get("/tickets")).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 600 });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries 5xx with backoff", async () => {
    const { client, sleep } = make([json({}, 503), json({}, 502), json([1])]);
    await expect(client.get("/tickets")).resolves.toEqual([1]);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("retries network errors then gives up", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const client = new FreshdeskClient({ ...cfg, maxRetries: 1 }, { fetchImpl: fetchImpl as any, sleep: async () => {} });
    await expect(client.get("/tickets")).rejects.toMatchObject({ code: "network_error" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    [401, "auth_failed"],
    [403, "forbidden"],
    [404, "not_found"],
    [400, "invalid_request"],
  ])("maps %i to %s without retrying", async (status, code) => {
    const { client, fetchImpl } = make([json({ description: "x" }, status)]);
    const err = await client.get("/tickets").catch((e) => e);
    expect(err).toBeInstanceOf(FreshdeskError);
    expect(err.code).toBe(code);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("pauses proactively when quota is nearly exhausted", async () => {
    const { client, sleep } = make([json([], 200, { "x-ratelimit-remaining": "2" }), json([])]);
    await client.get("/tickets");
    expect(sleep).not.toHaveBeenCalled();
    await client.get("/tickets");
    expect(sleep).toHaveBeenCalledWith(1000);
  });
});
