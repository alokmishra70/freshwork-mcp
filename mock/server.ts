/**
 * Local fake Freshdesk API (v2 subset) with fake data only.
 *   npm run mock                      -> http://localhost:4010
 *   MOCK_429_EVERY=5 npm run mock     -> every 5th request returns 429 + Retry-After: 2
 * Accepts any API key except the literal "bad-key" (to demo 401).
 */
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";

const now = Date.parse("2025-06-01T12:00:00Z");
const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();

const subjects = [
  ["Where is my order?", 2, 2, ["shipping"]],
  ["Refund for damaged item", 2, 3, ["refund"]],
  ["Wrong size delivered", 3, 2, ["exchange"]],
  ["Coupon code not working", 2, 1, ["coupon"]],
  ["Cannot update delivery address", 4, 2, ["shipping"]],
  ["Payment deducted but order failed", 2, 4, ["payment", "refund"]],
  ["Request invoice copy", 5, 1, ["invoice"]],
  ["Product out of stock after payment", 3, 3, ["inventory", "refund"]],
  ["Exchange policy question", 4, 1, ["exchange"]],
  ["Delivery delayed by 10 days", 2, 3, ["shipping"]],
] as const;

export const contacts = Array.from({ length: 8 }, (_, i) => ({
  id: 5000 + i,
  name: `Test Customer ${i + 1}`,
  email: `customer${i + 1}@example.com`,
  company_id: null,
  active: true,
  tags: [],
  created_at: iso(90 - i),
  updated_at: iso(i),
}));

export const tickets = Array.from({ length: 40 }, (_, i) => {
  const [subject, status, priority, tags] = subjects[i % subjects.length];
  const requester = contacts[i % contacts.length];
  return {
    id: 1001 + i,
    subject: `${subject} #${1001 + i}`,
    description_text: `Hi, this is ${requester.name} (${requester.email}, +1 555 010 ${String(1000 + i)}). ${subject}. Please help.`,
    status,
    priority,
    type: "Question",
    requester_id: requester.id,
    responder_id: i % 3 === 0 ? 9001 : null,
    group_id: null,
    tags: [...tags],
    is_escalated: priority === 4,
    created_at: iso(40 - i),
    updated_at: iso(Math.floor((40 - i) / 2)),
    due_by: iso(-3),
  };
});

const conversations = (t: (typeof tickets)[number]) => [
  { id: t.id * 10 + 1, incoming: true, private: false, user_id: t.requester_id, created_at: t.created_at, body_text: t.description_text },
  { id: t.id * 10 + 2, incoming: false, private: false, user_id: 9001, created_at: t.updated_at, body_text: "Thanks for reaching out, we are looking into it." },
  { id: t.id * 10 + 3, incoming: false, private: true, user_id: 9001, created_at: t.updated_at, body_text: "Internal: check with warehouse." },
];

const STATUS_FIELDS: Record<string, (t: any) => unknown> = {
  status: (t) => t.status,
  priority: (t) => t.priority,
  requester_id: (t) => t.requester_id,
  agent_id: (t) => t.responder_id,
};

function search(query: string) {
  const preds = query.split(" AND ").map((p) => {
    const m = p.trim().match(/^(\w+):(>|<)?'?([^']*)'?$/);
    if (!m) throw new Error("bad query");
    return { key: m[1], op: m[2], val: m[3] };
  });
  return tickets.filter((t) =>
    preds.every(({ key, op, val }) => {
      if (key === "tag") return t.tags.includes(val);
      if (key === "created_at" || key === "updated_at") {
        const d = (t as any)[key].slice(0, 10);
        return op === ">" ? d > val : d < val;
      }
      const get = STATUS_FIELDS[key];
      if (!get) throw new Error(`unsupported field ${key}`);
      return String(get(t)) === val;
    }),
  );
}

export function startMock(port = 0, opts: { rateLimitEvery?: number } = {}): Promise<{ server: Server; url: string; requests: () => number }> {
  let count = 0;
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", "x-ratelimit-total": "100", ...headers });
      res.end(JSON.stringify(body));
    };
    count++;
    const u = new URL(req.url!, "http://x");
    const key = Buffer.from((req.headers.authorization ?? "").replace("Basic ", ""), "base64").toString().split(":")[0];
    if (!key || key === "bad-key") return send(401, { code: "invalid_credentials", message: "Invalid credentials" });
    if (opts.rateLimitEvery && count % opts.rateLimitEvery === 0) {
      return send(429, { message: "Rate limit exceeded" }, { "retry-after": "2", "x-ratelimit-remaining": "0" });
    }
    const rate = { "x-ratelimit-remaining": String(Math.max(0, 100 - count)) };
    const q = u.searchParams;
    const pageNo = Number(q.get("page") ?? 1);
    const per = Math.min(100, Number(q.get("per_page") ?? 30));
    const paginate = <T,>(a: T[]) => a.slice((pageNo - 1) * per, pageNo * per);
    let m: RegExpMatchArray | null;

    try {
      if (u.pathname === "/api/v2/tickets") {
        let rows = [...tickets];
        const since = q.get("updated_since");
        if (since) rows = rows.filter((t) => t.updated_at >= since);
        const by = (q.get("order_by") ?? "created_at") as "created_at" | "updated_at" | "due_by" | "status";
        const dir = q.get("order_type") === "asc" ? 1 : -1;
        rows.sort((a, b) => (a[by] > b[by] ? dir : a[by] < b[by] ? -dir : 0));
        return send(200, paginate(rows), rate);
      }
      if (u.pathname === "/api/v2/search/tickets") {
        const raw = q.get("query") ?? "";
        if (!/^".*"$/.test(raw)) return send(400, { description: "query must be wrapped in double quotes" }, rate);
        const rows = search(raw.slice(1, -1));
        if (pageNo > 10) return send(400, { description: "page must be <= 10" }, rate);
        return send(200, { total: rows.length, results: rows.slice((pageNo - 1) * 30, pageNo * 30) }, rate);
      }
      if ((m = u.pathname.match(/^\/api\/v2\/tickets\/(\d+)\/conversations$/))) {
        const t = tickets.find((x) => x.id === Number(m![1]));
        return t ? send(200, paginate(conversations(t)), rate) : send(404, { description: "Record not found" }, rate);
      }
      if ((m = u.pathname.match(/^\/api\/v2\/tickets\/(\d+)$/))) {
        const t = tickets.find((x) => x.id === Number(m![1]));
        if (!t) return send(404, { description: "Record not found" }, rate);
        return send(200, q.get("include") === "conversations" ? { ...t, conversations: conversations(t) } : t, rate);
      }
      if (u.pathname === "/api/v2/contacts") {
        let rows = contacts;
        if (q.get("email")) rows = rows.filter((c) => c.email === q.get("email"));
        return send(200, paginate(rows), rate);
      }
      if ((m = u.pathname.match(/^\/api\/v2\/contacts\/(\d+)$/))) {
        const c = contacts.find((x) => x.id === Number(m![1]));
        return c ? send(200, c, rate) : send(404, { description: "Record not found" }, rate);
      }
      send(404, { description: "Unknown route" }, rate);
    } catch (e) {
      send(400, { description: (e as Error).message }, rate);
    }
  });
  return new Promise((resolve) =>
    server.listen(port, () => {
      const p = (server.address() as { port: number }).port;
      resolve({ server, url: `http://localhost:${p}/api/v2`, requests: () => count });
    }),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const every = Number(process.env.MOCK_429_EVERY ?? 0) || undefined;
  startMock(Number(process.env.MOCK_PORT ?? 4010), { rateLimitEvery: every }).then(({ url }) =>
    console.log(`Mock Freshdesk at ${url}${every ? ` (429 every ${every} requests)` : ""}`),
  );
}
