# Outcome integrations (roadmap Phase 2)

This feature keeps technical readiness, observed retrieval and observed outcomes
separate. Submission, traffic and conversion evidence do not guarantee indexing,
ranking or AI inclusion. Deployment comparisons are associations, not causation.

## Enable after review and migration

Apply `071_outcome_integrations.sql`, `072_search_console_appearance.sql` and
`073_outcome_alert_receipts.sql` through the existing guarded migration process.
No persistent or production database was changed. Hosted integration applies migrations only to its disposable test branch.
Keep the existing Neon project/branch/`aeo_app` identity guard unchanged.

`FEATURE_OUTCOME_INTEGRATIONS=1` exposes the owned workspace at
`/{lang}/dashboard/{clientId}/outcomes` and APIs. The shared plan capability
`outcome_integrations` permits Pro and Enterprise, including valid trials and
overrides; cancellation, expiration and delinquency use the normal resolver.
The flag defaults off. It is not an entitlement bypass.

Google continues to require `FEATURE_SEARCH_CONSOLE=1`, the existing OAuth
client configuration, approved redirect URI and `GOOGLE_TOKEN_ENCRYPTION_KEY`.
The existing settings connect/reconnect/revoke flow and asset property binding
are reused. Refresh tokens stay encrypted and account-bound. Search appearance
uses the same deadlines and run ledger. Google appearance types are discovered alone, then each type is used as a filter for date/page queries. Up to 20 discovered types are collected per bounded run; incomplete/capped appearance collection preserves stored categories and is labelled deferred. Core traffic/query writes are saved independently. Queries are sampled: 20 registered
pages, 25 queries per page/date, with at most 1,000 grouped queries in the outcome
view. Appearance categories may overlap. Old query rows without binding
provenance are hidden until refreshed; rebindings cannot present them as current.
Literal page/keyword cluster matching is labelled `fimmick-page-keyword.v1`.
Conversions remain associated with pages, not attributed to individual queries.

## IndexNow

Prepare a public key from the outcome workspace, publish its exact value at
`https://YOUR_DOMAIN/KEY.txt`, then explicitly submit up to 100 canonical HTTPS
URLs on one exact canonical host, including `www` when supplied. Ownership can use www/apex equivalence; proof never silently switches to the apex. The public key is not an API secret. Key-file verification
has no redirects, a 4 KiB response ceiling, a five-second timeout, public DNS
checks and a pinned connection. The fixed IndexNow endpoint uses the same guard.
Query strings and fragments are rejected rather than silently conflating pages.
Configure the site's canonical connector URLs deliberately.

The ledger distinguishes confirmed acceptance (200/202), refusal, blocked proof
and unknown delivery. Acceptance is not indexing proof. Identical intent keys
never repeat a provider request; changed payloads with the same intent return
409. Interrupted running attempts become visible unknown receipts. The UI can check the saved submission with the same intent after a lost response or unknown receipt; this never repeats the external request. Investigate
unknown delivery before creating another intent. No automatic external retry is
performed. This uses the provider-documented IndexNow protocol for Bing and other
participating engines; no unsupported Bing metrics API is invented.

## Signed first-party connector

Create a credential from the owned workspace. Its random signing secret is
returned once, stored only as account/purpose-bound AES-GCM ciphertext and never
returned by list/read operations. Removing the creator or revoking the key stops
ingestion. The runtime plan is checked for every request. This uses the existing
vault key, without rotating or exposing it.

POST `/api/outcomes/v1/analytics` with these headers:

```text
X-AISO-Key-Id: <credential UUID>
X-AISO-Timestamp: <10-digit Unix seconds>
X-AISO-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + exact UTF-8 body)>
Content-Type: application/json
```

Example body (replace the time with a recent timestamp):

```json
{"events":[{"eventId":"analytics:release-42:page-a:2026-10-25","occurredAt":"2026-10-25T00:00:00Z","pageUrl":"https://example.com/a","sessions":100,"conversions":4,"revenueMinor":12000,"currency":"HKD"}]}
```

Use compact server-side daily/page aggregates. Do not send visitor IDs, cookies,
email addresses, request headers, raw logs or arbitrary metadata. Unknown fields
are rejected. Event IDs are unique within the credential's client scope; keep the
same ID and payload on retry. Changed replays return 409 atomically, including
mixed old/new batches. Bodies are bounded to 64 KiB **during streaming**, batches
to 100 events, timestamps to the past 90 days and five minutes future, signatures
to a five-minute replay window. Re-sign retries with a fresh timestamp; retain
event IDs. Currency values are stored in minor units and never summed across
currencies. The atomic credential bucket allows 60 requests per minute; 429 means
retry later. The tenant comes from the key, never from body parameters.

POST `/api/outcomes/v1/deployments` with the same signing contract and a credential
carrying `deployments` scope:

```json
{"intentKey":"deployment:release-42","externalId":"release-42","deployedAt":"2026-10-25T00:00:00Z","urls":["https://example.com/a"],"baselineScanId":null,"workItemId":null}
```

Optional scan/work references must belong to this account and client; the scan
must predate deployment. The server freezes the scan baseline. Duplicate
references are idempotent; changed replays return 409. Session-authenticated
equivalents live under `/api/clients/{clientId}/outcomes/{action}` and enforce the
same flag, entitlement and ownership boundary.

## Regression evaluation and operating limits

The existing daily 04:17 UTC Worker trigger now also calls Search Console and
`/api/cron/outcomes`. The deployed AISO config still contains **exactly** 04:17
daily and Monday 07:47 UTC. The disabled 09:00 template schedule is not enabled;
trial-email behavior is untouched. No Worker was deployed by this change.

Evaluations freeze 7/28/56-day reported before/after counts with three extra days
for reporting latency. `fimmick-outcome-regression.v1` uses defaults of 10 score
points or 30% count decline with at least 25 reported exposures in both periods.
These thresholds are Fimmick heuristics, not provider recommendations. No zero
baseline, missing sample or incompatible scan method is reported as a successful
comparison. The score URL/method must match and both envelopes must be complete.
Outcomes include insufficient evidence and not comparable. Ineligible accounts are excluded before the due-batch limit using the shared catalogue and the commercial resolver rules, so cancelled accounts cannot starve entitled work. Failed or interrupted internal evaluations can retry up to three durable attempts, at least 20 hours apart; exhausted failures remain visible. External IndexNow attempts never retry automatically. Evaluation receipts
and regression records are durable; regression notifications are inserted
atomically and deduplicated by result. Read the saved evidence when a dependency
fails rather than assuming that an empty state means no change.

Optional crawler-log ingestion is intentionally deferred: the current architecture
has no verified provider-IP catalogue/refresh lifecycle. The UI states verified
retrieval is unavailable and never treats a user-agent string or owner report as
verified access. This optional path can be added without accepting raw logs.

Live acceptance still requires Willy's Google OAuth credentials/consent and
property access, the site's hosted IndexNow key, a first-party connector and a
reviewed application/Worker release. These are not exercised by synthetic tests.
