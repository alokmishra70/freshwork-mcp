/** Freshdesk API-key auth: HTTP Basic with the key as username and any string as password. */
export function basicAuthHeader(apiKey: string): string {
  return "Basic " + Buffer.from(`${apiKey}:X`).toString("base64");
}
