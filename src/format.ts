/** Trim raw Freshdesk payloads to the fields an agent needs, with human-readable labels. */

export const STATUS: Record<number, string> = { 2: "open", 3: "pending", 4: "resolved", 5: "closed" };
export const PRIORITY: Record<number, string> = { 1: "low", 2: "medium", 3: "high", 4: "urgent" };
export const STATUS_CODES = { open: 2, pending: 3, resolved: 4, closed: 5 } as const;
export const PRIORITY_CODES = { low: 1, medium: 2, high: 3, urgent: 4 } as const;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?<!\d)\+?\d[\d\s().-]{7,}\d(?!\d)/g;

export function redact(text: string | null | undefined, mask: boolean, maxLen = 2000): string | null {
  if (text == null) return null;
  let out = mask ? text.replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[phone]") : text;
  if (out.length > maxLen) out = out.slice(0, maxLen) + "… [truncated]";
  return out;
}

type Raw = Record<string, any>;

export function formatTicket(t: Raw, mask: boolean, withBody = false) {
  return {
    id: t.id,
    subject: redact(t.subject, mask, 300),
    status: STATUS[t.status] ?? String(t.status),
    priority: PRIORITY[t.priority] ?? String(t.priority),
    type: t.type ?? null,
    requester_id: t.requester_id ?? null,
    responder_id: t.responder_id ?? null,
    group_id: t.group_id ?? null,
    tags: t.tags ?? [],
    created_at: t.created_at,
    updated_at: t.updated_at,
    due_by: t.due_by ?? null,
    is_escalated: t.is_escalated ?? false,
    ...(withBody ? { description: redact(t.description_text, mask) } : {}),
  };
}

export function formatConversation(c: Raw, mask: boolean) {
  return {
    id: c.id,
    from: c.incoming ? "customer" : "agent",
    private_note: !!c.private,
    user_id: c.user_id ?? null,
    created_at: c.created_at,
    body: redact(c.body_text, mask),
  };
}

export function formatContact(c: Raw, mask: boolean) {
  return {
    id: c.id,
    name: c.name ?? null,
    email: mask ? redact(c.email, true) : (c.email ?? null),
    company_id: c.company_id ?? null,
    active: c.active ?? null,
    tags: c.tags ?? [],
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}
