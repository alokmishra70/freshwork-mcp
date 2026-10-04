import { writeFileSync } from "node:fs";
import { z } from "zod";
import { tools } from "../src/tools/index.js";

const spec = {
  server: { name: "freshdesk-mcp", version: "1.0.0", transport: "stdio", access: "read-only" },
  auth: { type: "api_key", env: ["FRESHDESK_DOMAIN", "FRESHDESK_API_KEY"] },
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: z.toJSONSchema(t.schema),
    annotations: { readOnlyHint: true },
  })),
};
writeFileSync("tool-spec.json", JSON.stringify(spec, null, 2) + "\n");
console.log(`wrote tool-spec.json (${spec.tools.length} tools)`);
