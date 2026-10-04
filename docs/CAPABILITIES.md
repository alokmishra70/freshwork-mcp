# What the agent can and can't do

The connector gives an Agent Studio agent read-only access to one Freshdesk account.

## What it can do

- Browse tickets with `list_tickets`, newest or recently updated first, with paging.
- Open a single ticket with `get_ticket`. This returns the description, and the reply thread if you ask for it.
- Search tickets with `search_tickets` by status, priority, tag, requester, assigned agent, and created or updated date. Filters are combined with AND.
- Read a ticket's full conversation with `list_ticket_conversations`. Private notes are included and marked as private.
- Look up customers with `list_contacts` (optionally by exact email) and `get_contact`.
- Cope with rate limits. On a 429 it waits for the time Freshdesk asks for and retries. It also retries server and network errors. If it still can't get through, it returns `{"error":"rate_limited","retry_after_seconds":N}` so the agent can tell the user or try again later.

## What it can't do

- Change anything. It can't create, reply to, update, assign, merge or delete tickets. There are no write tools.
- Read attachments. Only the text of tickets and replies comes through.
- Search ticket text. Freshdesk's search API works on fields only.
- Return more than 300 search results for one query (30 per page, 10 pages). If a search keeps saying there are more results, narrow the filters.
- Read orders or inventory. Freshdesk is a support tool, so the agent only sees order details that customers or agents typed into a ticket.
- Receive live updates. There are no webhooks, so the agent only sees data when it asks.
- Work with more than one Freshdesk account. Each server instance uses one API key and one domain.
- Act as different users. It sees whatever the API key's owner can see.

## How data is handled

- Responses are cut down to the fields the agent needs. Raw Freshdesk payloads are not passed through.
- By default (`MASK_PII=true`), email addresses and phone numbers in ticket and note text are replaced with `[email]` and `[phone]`, and contact emails are masked too. Names and ids are not masked. The masking is pattern-based, so it can miss unusual formats.
- Long text is cut to 2,000 characters.
- The API key is read from the environment. It is never logged or returned to the agent.
