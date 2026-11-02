# Conversation Studio — Save to Google Docs (post–Stage 6, PR 2 of 2)

- Brief: `docs/superpowers/plans/2026-11-02-aiso-brief-post6-drive-docs-mcp.md`
- ClickUp: [z8qgvcahq5](https://app.clickup.com/t/z8qgvcahq5)
- Lock: Willy answering **t223s832**: «MCP = **act／edit**, **not** scrape／SERP／「攞資料」».
- Decisions (Willy, 2026-11-02): option A; first job "Save to Google Docs"; per profile; no new flag.
- Builds on PR 1 (`docs/ux/conversation-studio-drive-connect.md`, migration `084`).

## What it does

Each **saved** Studio turn (6c thread persisted, turn saved) shows
**儲存至 Google 文件 / Save to Google Docs**. One click creates **one new** Google Doc
in the member's own Drive, with:

- the thread title, brand and save time;
- the question;
- the saved answer, using the same message keys as the on-screen reply. That
  covers status, scope line, the 待核實 search-demand caveat, opportunities,
  sources with record ids, timestamps, search evidence and http(s) links, and the
  scan id;
- coverage, the coverage meaning and missing-is-not-zero;
- a provenance line.

The Doc has no vendor names, no numbers that aren't on screen, and no raw
payloads. Every value is HTML-escaped, and only `http(s)` URLs become links. LIVE
model answers are not exported in v1.

## Flow and guarantees

`POST /api/dashboard/clients/[clientId]/studio/exports/google-docs` with body
`{ threadId, position, locale? }`:

1. Studio flag → profile → `platform_access` (`403 UPGRADE_REQUIRED`). Malformed
   JSON or any other key → `400 INVALID_STUDIO_INPUT`.
2. **Saved turn**, in one statement scoped by account, active brand and **this
   member's** thread → `404` when absent; `503` if the lookup fails.
3. **Connection:** none → `409 DRIVE_NOT_CONNECTED`; `needs_reconnect` →
   `409 DRIVE_RECONNECT`. No Google call either way.
4. **Token refresh.** `invalid_grant` flips the connection to `needs_reconnect`.
   A `401` / `invalid_client` is `503 DRIVE_MISCONFIGURED` and **never** flips it.
5. **Exactly one** Drive `files.create` (multipart upload converted to a Google
   Doc, `fields=id,webViewLink`). There are **no retries**: `files.create` is not
   idempotent.
6. **Ledger** (`085`, insert-only for `aeo_app`):
   - created → `201 { outcome: 'created', link }`
   - Google refused → recorded `failed`. The refusal maps to `429 DRIVE_QUOTA`,
     `403 DRIVE_FORBIDDEN`, `409 DRIVE_RECONNECT` (scope revoked; flips the
     connection) or `502 DRIVE_UNAVAILABLE`, and nothing was created.
   - response lost → recorded `unknown` → `202 { outcome: 'unknown' }`. The UI says
     the Doc **may** exist and links to Drive. A retry is a new, explicit click.
   - **Never a 2xx over a failed ledger write:** `500 DRIVE_LEDGER_FAILED`, with
     the link when Google returned one.

Only a `docs.google.com` / `drive.google.com` https link is ever returned or
rendered.

## Data

`085_studio_drive_exports.sql` (**file only**; not applied to any hosted
database) has these columns: `account_id`, `client_id`, `profile_id`, `thread_id`,
`turn_position`, `outcome` (`created` / `failed` / `unknown`, CHECK-mirrored by
`DRIVE_EXPORT_OUTCOMES`), `google_file_id`, `web_view_link` and `created_at`.

- Only a `created` row may name a file.
- Composite FKs go to `clients(id, account_id)` and `profiles(id, account_id)`.
- RLS is on with no policies. `aeo_app` has `select, insert` only.

PR 1's `084` was also tightened to `select, insert, update` for `aeo_app`, like
`054`'s `google_connections`.

## Until ops steps happen

Hosted Neon needs `081`, `054`, `084` and `085` applied under a named Approve. The
Drive API must be enabled and `drive.file` added to the consent screen (see the PR
1 doc). Until then, saving answers honestly with a 503, 409 or "not connected".

**待核實** (Google's docs were not reachable from the build environment):

- that HTML → Google Doc conversion via multipart upload works with only
  `drive.file`;
- that `webViewLink` is returned when it is named in `fields`.

Verify both on Preview before Prod.

## Tests

- `__tests__/integrations/google-drive-client.test.ts`:
  - URL, `fields`, Bearer, multipart framing and the Doc MIME type, with the token
    not in the body;
  - one call;
  - a lost response or a missing id → unknown;
  - refusal classification (scope, storage, quota, disabled API, 5xx);
  - non-Google links dropped.
- `__tests__/conversation-studio/drive-doc.test.ts`: escaping, http(s)-only links,
  the honesty caveats and provenance in both locales, no vendor names, the
  bounded Doc name, "no sources" rather than invented ones.
- `__tests__/conversation-studio/drive-export.test.ts`:
  - each step's refusal, and no Google work before the turn and connection are
    confirmed;
  - flip-to-reconnect only on a dead grant or scope;
  - unknown → no retry;
  - no 2xx over a failed ledger write, and no logged connection string.
- `__tests__/conversation-studio/drive-export-sql.test.ts`: PGlite runs `081` and
  `085`. The real turn query refuses another member's, another account's or an
  archived brand's turn. The real ledger insert works, and the outcome/file CHECKs
  and the composite FK hold.
- `__tests__/api/google-drive-export-route.test.ts`: the gate, body validation,
  session ids only, `no-store`, relayed refusals.
- Component tests: every response → state mapping, and each state in both locales.
- No live Google calls anywhere.

## HOLD / NO_GO

- No LIVE/`STUDIO_LIVE_ANSWERS_PER_WEEK`/`FEATURE_*`/env/GCP change.
- No hosted Neon migrate.
- No read, list, edit or delete of existing Drive files.
- No retries of `files.create`.
- No LIVE answer export in v1.
- No merge.
