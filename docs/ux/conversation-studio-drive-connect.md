# Conversation Studio — connect a member's own Google Drive (post–Stage 6, PR 1 of 2)

- Brief: `docs/superpowers/plans/2026-11-02-aiso-brief-post6-drive-docs-mcp.md`
- ClickUp: [z8qgvcahq5](https://app.clickup.com/t/z8qgvcahq5)
- Lock: Willy answering **t223s832**: «MCP = **act／edit**, **not** scrape／SERP／「攞資料」»; Google Drive／Docs first.
- Decisions (Willy, 2026-11-02): option A (AISO's backend writes to the member's own Drive via the Google API); first job "Save to Google Docs" (PR 2); one connection per profile; no new flag; Claude Code builds it.
- Base: `70c346c7e0c841470836dda03d7b74555e9d6a7f` (honesty rename #140)

## What this PR does

A Studio member can connect **their own** Google Drive from the Studio
connections view and disconnect it again. Nothing else uses the connection yet:
PR 2 adds "Save to Google Docs". AISO never calls the Drive API in this PR.

| Piece | Path |
| --- | --- |
| Migration (**file only**) | `supabase/migrations/084_google_drive_connections.sql` |
| Gate | `lib/integrations/google-drive/guard.ts` — `conversation_studio` flag → profile → `platform_access` |
| Store | `lib/integrations/google-drive/store.ts` — every query by `account_id` AND `profile_id` |
| Consent start | `GET /api/integrations/google/drive/start?return=…` |
| Consent finish | the existing `/api/integrations/google/callback`, handing off to `lib/integrations/google-drive/callback.ts` |
| Status / disconnect | `GET` / `DELETE /api/account/integrations/google-drive` |
| UI | Google Drive card in `StudioConnections`; post-consent notice from `?drive=…` |

## Security shape

- **Scope:** `openid email https://www.googleapis.com/auth/drive.file` only, so AISO
  can open only files it creates. The grant is refused unless Google returns both
  `drive.file` and a refresh token.
- **Shared callback, separate consent:** the Drive flow sets its own cookie
  (`aiso_google_drive_consent`) signed under its own HMAC domain
  (`aiso-google-drive-consent:v1`). The callback hands off to the Drive path only
  when that cookie verifies **and** its `state` equals the one Google returned.
  Otherwise the Search Console path runs unchanged; a Drive token never verifies
  as a Search Console token or the reverse. Reusing the callback means no new
  redirect URI to register.
- **Independent of Search Console:** the Drive path never reaches the Search
  Console gate (`FEATURE_SEARCH_CONSOLE` / `search_console` entitlement), and a
  Drive grant is never stored in, or revoked with, `054`'s `google_connections`.
- **Vault:** the refresh token is sealed with AAD `accountId` + purpose
  `drive:<profileId>`. It cannot be opened as a Search Console token or as another
  member's.
- **Tenancy:** `084` uses a composite FK `(profile_id, account_id) → profiles(id, account_id)`
  and one row per profile. RLS is on with no policies, and public/anon/
  authenticated/service-role are revoked, mirroring 080–083.
- **Never a success over a failed write:** a failed store returns the member to
  `?drive=error&reason=unavailable`; a failed delete is 503.
- **Disconnect** revokes the token at Google best-effort, then deletes AISO's
  copy regardless (as for Search Console). If Google refused the revoke, the card
  tells the member to remove AISO in their Google Account too.

## Until ops steps happen

- `084` is **not applied** to any hosted database. Until it is, the connection
  read fails and the card is **not shown** (an unknown state is never shown as
  未連接). Connect would also fail honestly at the store.
- The Google Drive API must be enabled in the GCP project behind
  `GOOGLE_OAUTH_CLIENT_ID`, and `drive.file` added to the OAuth consent screen.
  Until then Google rejects the consent and the member sees "Google Drive was not
  connected."
- The OAuth app is unverified (capped at 100 users). Whether `drive.file` is
  classified as non-sensitive is **待核實**: Google's docs were not reachable from
  the build environment.

No new environment variables: the existing `GOOGLE_OAUTH_CLIENT_ID`,
`GOOGLE_OAUTH_CLIENT_SECRET` and `GOOGLE_TOKEN_ENCRYPTION_KEY` (+ `_PREVIOUS`) are reused.

## Tests

- `__tests__/api/google-drive-connect.test.ts` — start: drive.file-only scope, the
  Drive cookie (domain-separated, path, flags), the Studio gate (404/401/403),
  independence from the Search Console flag; callback: hand-off stores a token
  sealed per profile, refuses a missing scope or refresh token, never reports
  connected over a failed write (and never logs a connection string), session
  mismatch, the Search Console path stays in charge when the Drive state doesn't
  match, a Drive cookie signed under the Search Console domain is ignored;
  account route: own summary, 503 on lookup failure, revoke then delete, 404/503.
- `__tests__/integrations/google-drive-store-sql.test.ts` — PGlite runs `084`:
  RLS on, one row per member, account+profile scoping, composite FK, revoke keeps
  the row, CHECK vocabulary and credential pairing.
- Component, loader and page tests — the card's states and connect link in both
  locales, notices, no card on an unknown read, the member's own row only, no
  Drive read for a foreign brand.
- Migration inventories pin `google_drive_connections`.
- No live Google calls anywhere in tests.

## HOLD / NO_GO

No LIVE/`STUDIO_LIVE_ANSWERS_PER_WEEK`/`FEATURE_*`/env/GCP change; no hosted Neon
migrate (054/081/082/083/084); no Drive API calls in this PR; no read, list,
edit or delete of Drive files; no broader Drive scope; no merge.
