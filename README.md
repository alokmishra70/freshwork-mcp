# Freshdesk MCP Connector

A small MCP server that lets an Agent Studio agent read tickets and contacts from Freshdesk. It is read-only, so the agent can look things up but can't change anything.

Auth is a Freshdesk API key. The tools are `list_tickets`, `get_ticket`, `search_tickets`, `list_ticket_conversations`, `list_contacts` and `get_contact`. It retries on rate limits and server errors.

More details: [what the agent can and can't do](docs/CAPABILITIES.md), and the [tool spec](tool-spec.json).

## Demo video

A short walkthrough of the connector running against the local mock: [watch the demo](https://drive.google.com/file/d/1N1MNASoPKOVdzT3iUAFxRGrXumKlNtq_/view?usp=sharing).

## Setup

You need Node 20 or newer.

```bash
npm install
cp .env.example .env
npm run build
```

Then fill in `.env`:

- `FRESHDESK_DOMAIN` is the part before `.freshdesk.com` in your account URL.
- `FRESHDESK_API_KEY` is in Freshdesk under Profile Settings, then "View API Key".

Don't commit `.env`. It's already in `.gitignore`.

To check that the connection works, run:

```bash
npm run smoke
```

## Trying it without a Freshdesk account

There is a fake Freshdesk API in `mock/server.ts`. It has 40 made-up tickets and 8 made-up contacts, and no real data. Any API key works except `bad-key`, which returns a 401.

Start it in one terminal. Setting `MOCK_429_EVERY=4` makes every 4th request fail with a 429, so you can watch the retry logic work:

```bash
MOCK_429_EVERY=4 npm run mock
```

In another terminal, point the connector at it:

```bash
export FRESHDESK_BASE_URL=http://localhost:4010/api/v2
export FRESHDESK_API_KEY=demo
npm run smoke
```

You should see it pause for a couple of seconds on each 429 and then carry on.

## Running the server

It talks MCP over stdio.

```bash
npm start       # after npm run build
npm run dev     # straight from source
```

On startup it makes one test call to Freshdesk. If the key or domain is wrong it exits with a clear message instead of failing later inside the agent.

To register it in Agent Studio (or any MCP client) as a stdio server:

```json
{
  "mcpServers": {
    "freshdesk": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-commerece/dist/index.js"],
      "env": {
        "FRESHDESK_DOMAIN": "your-subdomain",
        "FRESHDESK_API_KEY": "<from your secret store>"
      }
    }
  }
}
```

If you use the mock, set `FRESHDESK_BASE_URL` in `env` instead of `FRESHDESK_DOMAIN`.

`tool-spec.json` has the tool definitions as JSON Schema, for platforms that want a static spec. Regenerate it with `npm run spec`.

## Tests

```bash
npm test
```

Most tests mock the HTTP layer. They cover the auth header, 429 with `Retry-After`, running out of retries, 5xx and network errors, error mapping, query building, and a full MCP client-to-server round trip. A few more run the tools against the local mock server over real HTTP.

## How rate limits are handled

| What happens | What the connector does |
|---|---|
| 429 with `Retry-After` of 60s or less | Waits that long and retries, up to `MAX_RETRIES` times (default 3) |
| 429 with a longer wait, or retries used up | Returns a `rate_limited` error with `retry_after_seconds` so the agent can tell the user |
| 5xx or network error | Retries with exponential backoff and jitter, then returns `upstream_error` or `network_error` |
| `X-RateLimit-Remaining` is 3 or less | Waits 1 second before the next request |
| 400, 401, 403, 404 | No retry. Returned as `invalid_request`, `auth_failed`, `forbidden` or `not_found` |

## Assumptions and limitations

- I haven't tested this against a real Freshdesk account. I built and demoed it against the local mock plus unit tests with mocked HTTP. The mock follows the Freshdesk v2 docs as I read them, but it only covers a subset of the API, so a real account may behave a bit differently.
- Auth is an API key, not OAuth. The key acts with the permissions of the agent it belongs to.
- It is read-only on purpose. Write tools would need a confirmation step.
- One Freshdesk account per server process, and no caching.
- Freshdesk search only works on fields (status, priority, tag, dates and so on), not on free text, and it returns at most 300 results per query.
- `get_ticket` with conversations returns at most 10 conversations. Use `list_ticket_conversations` to page through longer threads.
- Masking of emails and phone numbers is regex-based, so treat it as best effort.
- Rate limits depend on your Freshdesk plan. If you see a lot of 429s, check your plan's per-minute limit.
- Stdio only. A hosted deployment would need an HTTP transport.
