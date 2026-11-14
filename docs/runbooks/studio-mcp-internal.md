# Studio MCP — internal read-only surface

Status: **internal preview, OFF by default in code.** Source reviewed 2026-11-14
at `73e97904550eff953ef70bf0ed74c62ea4b3eab3`; deployed flags, credentials and
bearer-only tool usability were not probed for that review. No business-write
tools, scheduled reads or provider calls are implemented by this transport.

The JSON-RPC-over-HTTP endpoint at `POST /api/mcp/studio` registers six tools in
[the registry](../../lib/conversation-studio/mcp/registry.ts) against the brand's
**saved** AISO records. It never calls Google, DataForSEO, Firecrawl or a model,
and does not save drafts or delivery. It **does append call-audit rows** before
returning tool results. Registration alone does not prove each loader works from
an external bearer-only client; see the session-dependent opportunity caveat below.

Enabling, token minting and transport examples below are operator procedures,
not authorization to execute them during a source-only readiness review. The
[dated capability ledger](../ux/sme-capability-readiness.md) records that boundary.

## What is served

| Tool | Reads |
|---|---|
| `brand_evidence` | latest saved Pulse week, observations, scan header |
| `scan_checks` | check assessments from the latest retained scan |
| `content_opportunities` | current rule-derived opportunities |
| `brand_sources` | agent-usable sources + version metadata (no bodies) |
| `work_item_drafts` | draft work items (no bodies or evidence snapshots) |
| `search_console_status` | saved connection/binding/sync state (no Google call) |

A recognized `tools/call` result is written to `studio_mcp_calls` **before** its
data is returned; if that insert fails, the request fails with
`503 {"error":"AUDIT_UNAVAILABLE"}` rather than serving an unlogged tool result.
Unknown-tool calls are also audited, before the rate-count branch. Initialize,
ping, tool listing and notifications return without call-audit writes; a failed
count returns 503 without an audit row. The table is insert-only for `aeo_app`.

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

The token is valid for one hour and names one member and one brand; it is not a
frozen permission grant. The transport re-reads the profile, active brand access,
staff grant and owning account's plan on each request. Membership/access loss,
a transferred or inactive brand, or loss of a required staff grant ends access.
A downgrade updates entitlement-bound tool availability (currently Search Console)
rather than invalidating all token access to the other registered reads.

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
- This remains an internal surface, but the current gated Studio Tools page
  includes a [Connect Assistant card](../../components/dashboard/StudioConnectAssistant.tsx)
  that can mint/copy a token when the MCP flag and secret checks pass. UI presence
  is not evidence that a deployment is enabled or externally usable.
- `content_opportunities` currently calls the normal browser-session-authenticated
  [opportunity service](../../lib/opportunities/service.ts) through its Studio
  loader. The executor's bearer principal does not replace that downstream session.
  Without a member session the loader maps unauthenticated access to unavailable;
  bearer-only success is not established by the registry or mocked executor tests.
  This is a source finding, not an executed production failure or a code fix.

## Rate limit (slice 3)

A `tools/call` for a **recognized** tool counts this principal's rows in
`studio_mcp_calls` for the last 60 seconds. At **30 or more** the call is refused
with JSON-RPC `-32000 "Rate limit exceeded"`, recorded as `denied` /
`RATE_LIMITED`, and no tool executes. Unknown-tool calls audit and return before
this count branch; their rows still contribute to a later recognized-tool count,
as do failed and denied calls. This is a count-then-execute guard, not an atomic
concurrent reservation or a rate gate on every RPC method.

If the count cannot be read, the transport returns 503 `AUDIT_UNAVAILABLE` without
an audit row or tool execution. There is no new table or counter: the existing
ledger holds the data and
[`STUDIO_MCP_CALLS_PER_MINUTE`](../../lib/conversation-studio/mcp/audit.ts) is the bound.

## Skill map (slice 3)

The in-product skill vocabulary maps to registered read tools in the shared
[skill registry](../../lib/conversation-studio/skills.ts). This map is not an
execution trace: current skill taps use the saved composer and side endpoints,
not the MCP transport. Context taps suppress LIVE answers, but separately gated
Google/DataForSEO/Firecrawl requests may still run. They also save Studio turns.
The confirmed scan/Improve/report action panel is already wired to existing
application endpoints; older slice labels describing it as future work are historical.

| Skill id | Reads (MCP tools) |
| --- | --- |
| `visibility_now` | `brand_evidence` |
| `what_ai_says` | `brand_evidence`, `brand_sources` |
| `top_opportunity` | `scan_checks`, `content_opportunities` |
| `improve_page` | `scan_checks`, `content_opportunities`, `brand_sources` |
| `compare_competitors` | `brand_evidence` |
| `draft_brief` | `content_opportunities`, `brand_sources` |
| `monthly_report` | `brand_evidence`, `scan_checks`, `work_item_drafts`, `search_console_status` |
| `scan_brand` | `scan_checks` (confirmed action is wired; gates apply, MCP read tools unchanged) |
| `explain_drop` | `brand_evidence` |

Threads persist the skill they started from (migration `109`, nullable, closed
vocabulary); turns keep their own `task` for composition and idempotency. Older
threads derive the skill from the first turn exactly as before.
