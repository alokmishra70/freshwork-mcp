// Live check against your Freshdesk trial: npm run smoke
import "dotenv/config";
import { FreshdeskClient } from "../src/client.js";
import { loadConfig } from "../src/config.js";
import { tools } from "../src/tools/index.js";

const cfg = loadConfig();
const ctx = { client: new FreshdeskClient(cfg), maskPii: cfg.maskPii };
const call = (n: string, a: object) => {
  const t = tools.find((x) => x.name === n)!;
  return t.handler(t.schema.parse(a), ctx);
};

const list: any = await call("list_tickets", { per_page: 3 });
console.log("list_tickets:", list.tickets.map((t: any) => `#${t.id} ${t.subject}`));
if (list.tickets[0]) {
  const got: any = await call("get_ticket", { ticket_id: list.tickets[0].id, include_conversations: true });
  console.log("get_ticket:", got.ticket.subject, `(${got.conversations.length} conversations)`);
}
const s: any = await call("search_tickets", { status: "open" });
console.log("search_tickets open:", s.total);
