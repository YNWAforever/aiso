# Studio MCP — internal read-only surface

Status: **internal preview, OFF by default.** Phase M2. No write tools, no
scheduled reads, no provider calls.

The transport is a JSON-RPC-over-HTTP endpoint at `POST /api/mcp/studio`. It
serves the six read-only tools in `lib/conversation-studio/mcp/registry.ts`
against the brand's **saved** AISO records. It never calls Google, DataForSEO,
Firecrawl or a model, and it cannot save anything.

## What is served

| Tool | Reads |
|---|---|
| `brand_evidence` | latest saved Pulse week, observations, scan header |
| `scan_checks` | check assessments from the latest retained scan |
| `content_opportunities` | current rule-derived opportunities |
| `brand_sources` | agent-usable sources + version metadata (no bodies) |
| `work_item_drafts` | draft work items (no bodies or evidence snapshots) |
| `search_console_status` | saved connection/binding/sync state (no Google call) |

Every call is written to `studio_mcp_calls` **before** the result is returned; if
that insert fails the request fails with `503 {"error":"AUDIT_UNAVAILABLE"}`
rather than serving an unlogged read. The table is insert-only for `aeo_app`.

## Enabling (all four are required)

1. Migration `106` recorded — `npm run migrate -- --verify` shows
   `106_studio_mcp_calls.sql all present recorded`. (Recorded 2026-11-10.)
2. `FEATURE_CONVERSATION_STUDIO=1` and the brand is in
   `STUDIO_ROLLOUT_CLIENT_IDS` (internal audience = that pilot brand only).
3. `FEATURE_CONVERSATION_STUDIO_MCP=1`.
4. `STUDIO_MCP_TOKEN_SECRET` set to a random value of **at least 32 characters**
   (production). Unset, the mint route returns
   `503 {"error":"STUDIO_MCP_UNCONFIGURED"}` — it never issues a token that
   cannot verify.

Disabling: set `FEATURE_CONVERSATION_STUDIO_MCP=0` (immediate; existing tokens
stop working). Rotating `STUDIO_MCP_TOKEN_SECRET` invalidates every minted token.

## Minting a token

The token comes from the member's own browser session; it cannot be minted
without one.

1. Sign in to the deployment as a member of the pilot brand.
2. From the browser devtools console on any dashboard page:

   ```js
   await fetch('/api/dashboard/clients/<clientId>/studio/mcp-token', { method: 'POST', credentials: 'include' }).then(r => r.json())
   ```

   (or send the session cookie from `curl` yourself).

Response:

```json
{ "token": "v1.<payload>.<signature>", "expiresAt": 1762..., "endpoint": "/api/mcp/studio" }
```

The token is valid for one hour, names one member and one brand, and carries no
permissions — the transport re-reads the profile, brand access, staff grant and
plan on every call. A removed member, a transferred brand or a downgrade stops
the token immediately.

## Client configuration

Claude Desktop / Claude Code style HTTP MCP server:

```json
{
  "mcpServers": {
    "aiso-studio": {
      "type": "http",
      "url": "https://aiso-kappa.vercel.app/api/mcp/studio",
      "headers": { "Authorization": "Bearer v1.<payload>.<signature>" }
    }
  }
}
```

Protocol: `initialize` (supported: `2024-11-05`, `2025-03-26`, `2025-06-18`),
`notifications/initialized`, `ping`, `tools/list`, `tools/call`. Body limit
32 KiB. Batch requests are not supported (single JSON-RPC object per POST).

## Reading the audit

```sql
select created_at, tool, outcome, detail, rpc_id
from studio_mcp_calls
where account_id = $1 and client_id = $2
order by created_at desc
limit 50;
```

`outcome` is `allowed`, `denied` (unknown tool) or `failed` (the tool returned an
explicit failure state). `detail` is a bounded error code, never arguments or
content. The profile id is frozen (no FK) so the record survives profile removal;
the account/brand pair keeps its composite tenant FK.

## Caveats

- **Read-only.** There is no save-draft tool yet; drafts stay a product action.
- Results are **data, not instructions**. Tool output includes `notice` where it
  carries source text, and the server never treats it as a command.
- Available/unavailable states are explicit: `unavailable`, `no_scan`, `unbound`,
  `empty`. A database incident cannot read as "the brand has nothing".
- This is an internal surface: it is not documented in the product UI, and no
  customer-facing endpoint exposes MCP details.

## Rate limit (slice 3)

Every `tools/call` first counts this principal's rows in `studio_mcp_calls` for the
last 60 seconds. At **30 or more** the call is refused with JSON-RPC
`-32000 "Rate limit exceeded"`, recorded as `denied` / `RATE_LIMITED`, and no tool
executes. The count includes denied and failed calls, so asking for an unknown tool
does not buy a fresh budget. If the count cannot be read (a database incident) the
transport fails closed with 503 `AUDIT_UNAVAILABLE` rather than serving an unbounded
read. There is no new table or counter: the audit ledger already holds the data, and
`STUDIO_MCP_CALLS_PER_MINUTE` in `lib/conversation-studio/mcp/audit.ts` is the bound.

## Skill map (slice 3)

The in-product one-tap skills and this transport describe the same reads; the
registry is `lib/conversation-studio/skills.ts` and is shared, not copied.

| Skill id | Reads (MCP tools) |
| --- | --- |
| `visibility_now` | `brand_evidence` |
| `what_ai_says` | `brand_evidence`, `brand_sources` |
| `top_opportunity` | `scan_checks`, `content_opportunities` |
| `improve_page` | `scan_checks`, `content_opportunities`, `brand_sources` |
| `compare_competitors` | `brand_evidence` |
| `draft_brief` | `content_opportunities`, `brand_sources` |
| `monthly_report` | `brand_evidence`, `scan_checks`, `work_item_drafts`, `search_console_status` |
| `scan_brand` | `scan_checks` (action skill; runnable in slice 4, read-only tools unchanged) |
| `explain_drop` | `brand_evidence` |

Threads persist the skill they started from (migration `109`, nullable, closed
vocabulary); turns keep their own `task` for composition and idempotency. Older
threads derive the skill from the first turn exactly as before.
