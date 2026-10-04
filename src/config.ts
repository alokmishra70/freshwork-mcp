import { z } from "zod";

const schema = z.object({
  FRESHDESK_DOMAIN: z
    .string()
    .transform((d) => d.replace(/^https?:\/\//, "").replace(/\.freshdesk\.com.*$/, ""))
    .refine((d) => d === "" || /^[a-z0-9-]+$/i.test(d), "FRESHDESK_DOMAIN must be a subdomain like 'acme'")
    .default(""),
  // Override for the local mock server, e.g. http://localhost:4010/api/v2
  FRESHDESK_BASE_URL: z.string().url().optional(),
  FRESHDESK_API_KEY: z.string().min(1, "FRESHDESK_API_KEY is required"),
  MASK_PII: z.enum(["true", "false"]).default("true"),
  MAX_RETRIES: z.coerce.number().int().min(0).max(6).default(3),
});

export interface Config {
  baseUrl: string;
  apiKey: string;
  maskPii: boolean;
  maxRetries: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const c = parsed.data;
  if (!c.FRESHDESK_BASE_URL && !c.FRESHDESK_DOMAIN) {
    throw new Error("Invalid configuration: FRESHDESK_DOMAIN is required (or FRESHDESK_BASE_URL for the mock)");
  }
  return {
    baseUrl: (c.FRESHDESK_BASE_URL ?? `https://${c.FRESHDESK_DOMAIN}.freshdesk.com/api/v2`).replace(/\/$/, ""),
    apiKey: c.FRESHDESK_API_KEY,
    maskPii: c.MASK_PII === "true",
    maxRetries: c.MAX_RETRIES,
  };
}
