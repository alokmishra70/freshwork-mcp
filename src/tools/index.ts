import { z } from "zod";
import type { FreshdeskClient } from "../client.js";
import {
  PRIORITY_CODES,
  STATUS_CODES,
  formatContact,
  formatConversation,
  formatTicket,
} from "../format.js";

export interface ToolDef<S extends z.ZodObject<any> = z.ZodObject<any>> {
  name: string;
  description: string;
  schema: S;
  handler: (args: z.infer<S>, ctx: ToolCtx) => Promise<unknown>;
}
export interface ToolCtx {
  client: FreshdeskClient;
  maskPii: boolean;
}

const page = z.number().int().min(1).max(10_000).default(1).describe("Page number, starting at 1");
const perPage = z.number().int().min(1).max(100).default(30).describe("Results per page (max 100)");
const ticketId = z.number().int().positive().describe("Freshdesk ticket id");

function def<S extends z.ZodObject<any>>(d: ToolDef<S>): ToolDef {
  return d as unknown as ToolDef;
}

export const tools: ToolDef[] = [
  def({
    name: "list_tickets",
    description:
      "List tickets, newest first by default. Use for browsing recent or recently-updated tickets. " +
      "To filter by status, priority, tag or date ranges use search_tickets instead. " +
      "Returns up to per_page tickets; has_more=true means request the next page.",
    schema: z.object({
      filter: z
        .enum(["new_and_my_open", "watching", "spam", "deleted"])
        .optional()
        .describe("Freshdesk predefined filter. Omit for all non-deleted, non-spam tickets."),
      updated_since: z.string().optional().describe("ISO 8601 timestamp, e.g. 2025-01-31T00:00:00Z"),
      order_by: z.enum(["created_at", "due_by", "updated_at", "status"]).default("created_at"),
      order_type: z.enum(["asc", "desc"]).default("desc"),
      page,
      per_page: perPage,
    }),
    handler: async (a, { client, maskPii }) => {
      const rows = await client.get<any[]>("/tickets", { ...a });
      return { tickets: rows.map((t) => formatTicket(t, maskPii)), page: a.page, has_more: rows.length === a.per_page };
    },
  }),

  def({
    name: "get_ticket",
    description:
      "Get one ticket by id, including its description. Set include_conversations to also fetch the reply/note thread.",
    schema: z.object({
      ticket_id: ticketId,
      include_conversations: z.boolean().default(false).describe("Also return the conversation thread (up to 10)"),
    }),
    handler: async (a, { client, maskPii }) => {
      const t = await client.get<any>(`/tickets/${a.ticket_id}`, {
        include: a.include_conversations ? "conversations" : undefined,
      });
      return {
        ticket: formatTicket(t, maskPii, true),
        ...(a.include_conversations
          ? { conversations: (t.conversations ?? []).map((c: any) => formatConversation(c, maskPii)) }
          : {}),
      };
    },
  }),

  def({
    name: "search_tickets",
    description:
      "Search tickets by status, priority, tag, requester, assigned agent or date. All filters are combined with AND. " +
      "Freshdesk caps search at 30 results/page and 10 pages (300 results total); narrow the filters if has_more stays true.",
    schema: z.object({
      status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      tag: z.string().max(100).optional(),
      requester_id: z.number().int().positive().optional(),
      agent_id: z.number().int().positive().optional(),
      created_after: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD"),
      created_before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD"),
      updated_after: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD"),
      page: z.number().int().min(1).max(10).default(1).describe("Page 1-10"),
    }),
    handler: async (a, { client, maskPii }) => {
      const parts: string[] = [];
      if (a.status) parts.push(`status:${STATUS_CODES[a.status as keyof typeof STATUS_CODES]}`);
      if (a.priority) parts.push(`priority:${PRIORITY_CODES[a.priority as keyof typeof PRIORITY_CODES]}`);
      if (a.tag) parts.push(`tag:'${a.tag.replace(/['"\\]/g, "")}'`);
      if (a.requester_id) parts.push(`requester_id:${a.requester_id}`);
      if (a.agent_id) parts.push(`agent_id:${a.agent_id}`);
      if (a.created_after) parts.push(`created_at:>'${a.created_after}'`);
      if (a.created_before) parts.push(`created_at:<'${a.created_before}'`);
      if (a.updated_after) parts.push(`updated_at:>'${a.updated_after}'`);
      if (parts.length === 0) throw new Error("Provide at least one search filter, or use list_tickets.");
      const r = await client.get<{ results: any[]; total: number }>("/search/tickets", {
        query: `"${parts.join(" AND ")}"`,
        page: a.page,
      });
      return {
        total: r.total,
        tickets: r.results.map((t) => formatTicket(t, maskPii)),
        page: a.page,
        has_more: a.page < 10 && a.page * 30 < r.total,
      };
    },
  }),

  def({
    name: "list_ticket_conversations",
    description: "List the replies and notes on a ticket, oldest first. Private notes are flagged private_note=true.",
    schema: z.object({ ticket_id: ticketId, page, per_page: perPage }),
    handler: async (a, { client, maskPii }) => {
      const rows = await client.get<any[]>(`/tickets/${a.ticket_id}/conversations`, {
        page: a.page,
        per_page: a.per_page,
      });
      return {
        conversations: rows.map((c) => formatConversation(c, maskPii)),
        page: a.page,
        has_more: rows.length === a.per_page,
      };
    },
  }),

  def({
    name: "list_contacts",
    description: "List customer contacts, optionally filtered by exact email or updated_since.",
    schema: z.object({
      email: z.string().email().optional().describe("Exact email match"),
      updated_since: z.string().optional().describe("ISO 8601 timestamp"),
      page,
      per_page: perPage,
    }),
    handler: async (a, { client, maskPii }) => {
      const rows = await client.get<any[]>("/contacts", { ...a });
      return { contacts: rows.map((c) => formatContact(c, maskPii)), page: a.page, has_more: rows.length === a.per_page };
    },
  }),

  def({
    name: "get_contact",
    description: "Get one customer contact by id.",
    schema: z.object({ contact_id: z.number().int().positive() }),
    handler: async (a, { client, maskPii }) => ({
      contact: formatContact(await client.get<any>(`/contacts/${a.contact_id}`), maskPii),
    }),
  }),
];
