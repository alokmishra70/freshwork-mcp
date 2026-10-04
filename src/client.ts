import { basicAuthHeader } from "./auth.js";
import type { Config } from "./config.js";

export type ErrorCode =
  | "auth_failed"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "rate_limited"
  | "upstream_error"
  | "network_error";

export class FreshdeskError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status?: number,
    public retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "FreshdeskError";
  }
}

export interface ClientDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const MAX_WAIT_MS = 60_000;
const BASE_BACKOFF_MS = 500;
const TIMEOUT_MS = 20_000;
const LOW_REMAINING = 3;

export class FreshdeskClient {
  private fetchImpl: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private random: () => number;
  private remaining: number | undefined;

  constructor(
    private cfg: Pick<Config, "baseUrl" | "apiKey" | "maxRetries">,
    deps: ClientDeps = {},
  ) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = deps.random ?? Math.random;
  }

  async get<T>(path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const url = new URL(this.cfg.baseUrl + path);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    // Proactive throttle: if the last response said we're almost out of quota, pause briefly.
    if (this.remaining !== undefined && this.remaining <= LOW_REMAINING) {
      await this.sleep(1000);
    }

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: "GET",
          headers: { Authorization: basicAuthHeader(this.cfg.apiKey), Accept: "application/json" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        if (attempt < this.cfg.maxRetries) {
          await this.sleep(this.backoff(attempt));
          continue;
        }
        throw new FreshdeskError("network_error", `Network error: ${(e as Error).message}`);
      }

      const rem = res.headers.get("x-ratelimit-remaining");
      if (rem !== null && !Number.isNaN(Number(rem))) this.remaining = Number(rem);

      if (res.ok) return (await res.json()) as T;

      if (res.status === 429) {
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
        const waitMs = retryAfter !== undefined ? retryAfter * 1000 : this.backoff(attempt);
        if (attempt < this.cfg.maxRetries && waitMs <= MAX_WAIT_MS) {
          await this.sleep(waitMs);
          continue;
        }
        throw new FreshdeskError(
          "rate_limited",
          "Freshdesk rate limit exceeded. Try again later.",
          429,
          retryAfter ?? Math.ceil(waitMs / 1000),
        );
      }

      if (res.status >= 500) {
        if (attempt < this.cfg.maxRetries) {
          await this.sleep(this.backoff(attempt));
          continue;
        }
        throw new FreshdeskError("upstream_error", `Freshdesk returned ${res.status}`, res.status);
      }

      throw await toClientError(res);
    }
  }

  /** Exponential backoff with full jitter, capped. */
  private backoff(attempt: number): number {
    return Math.min(MAX_WAIT_MS, BASE_BACKOFF_MS * 2 ** attempt) * (0.5 + this.random() / 2);
  }
}

function parseRetryAfter(v: string | null): number | undefined {
  if (v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

async function toClientError(res: Response): Promise<FreshdeskError> {
  let detail = "";
  try {
    const body = (await res.json()) as { description?: string; message?: string };
    detail = body.description ?? body.message ?? "";
  } catch {
    /* non-JSON body */
  }
  switch (res.status) {
    case 401:
      return new FreshdeskError("auth_failed", "Authentication failed: check FRESHDESK_API_KEY and domain.", 401);
    case 403:
      return new FreshdeskError("forbidden", `Access denied. ${detail}`.trim(), 403);
    case 404:
      return new FreshdeskError("not_found", `Resource not found. ${detail}`.trim(), 404);
    default:
      return new FreshdeskError("invalid_request", `Request rejected (${res.status}). ${detail}`.trim(), res.status);
  }
}
