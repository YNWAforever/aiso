# Enterprise operating system (roadmap Phase 4)

Stack after Phase 2 (#113) and Phase 3 (#114). No deployment, production migration,
secret change, live provider call or merge is performed by this implementation.

## Release prerequisites

Apply `076_enterprise_access.sql`, `077_enterprise_reports_workflows.sql` and
`078_enterprise_delivery_adapters.sql`, after 071–075, with the established guarded
migration workflow. `db()` and the existing Neon binding/role guards remain in
force. Do not apply these to a persistent database for local acceptance tests.
The SQL contract tests use fresh in-memory PGlite, including the `aeo_app` role.

`FEATURE_ENTERPRISE_OS=1` is required. It defaults off. Shared runtime catalogue
capabilities are Enterprise-only: `white_label_portals`, `scheduled_reports`,
`public_api`, `webhooks`, `enterprise_workflows`, `multi_market_benchmarks`, and
`custom_adapters`. Paid/trial/override/lapsed subscription resolution is shared
with the rest of the application. SQL eligibility is tested against that resolver
and filters cron batches before limits. Marketing release claims are unchanged.

Willy must configure/confirm existing `GOOGLE_TOKEN_ENCRYPTION_KEY` (and retained
previous key during an existing rotation), `REPORT_SHARE_SECRET`,
`NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, and optional `RESEND_API_KEY` /
`RESEND_FROM_EMAIL`. API secrets and webhook destinations/secrets use separate
account- and purpose-bound AES-GCM ciphertexts in the existing vault. There is no
plaintext fallback. No rotation or live email test is implicit in release.

A platform administrator must explicitly grant enterprise editor/manager roles
through `/api/admin/accounts/{accountId}/enterprise-roles` or the admin control in
an owned Enterprise workspace. Default is viewer. Role changes use optimistic
revision, stable request ID, reason, account/profile locks and immutable events.
Existing active approver grants, with event lineage, remain the sole approval
boundary. Manager does not imply approver; approver does not imply manager.
Authors and submitters cannot approve their own retained artifact. This preserves
existing authority rather than inventing workspace-admin delegation or solo
approval policy. The role-grant product question does not block this conservative
implementation; changing that authority remains a separate product decision.

## Workspace, reports and portals

`/{lang}/dashboard/{clientId}/enterprise` is linked from Monitor. The session API
is GET `/api/clients/{clientId}/enterprise`; POST `/{action}` supports branding,
reports, schedules, decision, publish, revoke, keys, webhooks, adapters,
adapter-run, draft-review and retry. All actions verify owned client, current
commercial entitlement and required role. Inputs are streamed/bounded to 64 KiB
and parsed before business writes. Both en and zh-HK are supported.

Executive snapshots freeze the selected UTC window, branding and compact stored
technical/readiness, unavailable verified retrieval, GSC property aggregates,
currency-separated analytics and accepted AI evidence aggregates. Provider
observation coverage is capped at the latest 500 *within the chosen window*;
connector-reported counts remain separate. No raw prompts, answers or visitor
identifiers enter public snapshots. GSC data respects current binding generation.
Legacy competitor references are normalized without requiring later domain fields.
When a historical manifest lacks its owned domain, citation attribution remains
unknown rather than being assigned to the current client domain.
Technical score is the latest as of window end and retains its recorded time and
known/unknown method. Query attribution and heuristics do not become causal claims.

Snapshots and exact content hashes are immutable to `aeo_app`. Migrations first
revoke the broad role-specific default grants from migration 037, then grant
only intended rights; tests reproduce those inherited defaults. The database
computes SHA-256 over canonical PostgreSQL JSONB text at insert. Approval records
bind that exact hash and the existing grant event/revision. Visibility drafts can
be retained for approval without applying, modifying or deploying their content.

A manager can publish an approved executive snapshot. Revocable portal links bind
random 32-character slug, version and locale with a purpose-separated HMAC using
`REPORT_SHARE_SECRET`. Public reads recheck active client, current Enterprise
entitlement and the matching approved hash. Branding edits cannot rewrite an old
publication. The public DTO replaces the upstream logo URL with a signed same-app
proxy; the proxy uses existing bounded HTTPS/public-DNS/image-signature guards.
Portal links are noindex and send no referrer; logo responses use no-store so
revocation is not defeated by a shared image cache. No ranking/AI inclusion
promise is made. Private historical report links resolve the exact owned report
ID independently of the recent 20-row workspace list.

## Schedules and durable delivery

Weekly means Monday–Sunday UTC; monthly means a calendar month UTC. Approval sets
a persisted period watermark to the current week/month start. The first report
is generated when that period closes. Each daily tick inserts a period and
advances the watermark atomically. Downtime leaves later periods due; no
unrecorded date cursor is advanced. Catch-up is bounded to 20 schedules per tick.
A schedule freezes branding, locale and up to 20 selected account-member IDs.
It authorizes private report generation, not automatic public publication.

Report artifact, period completion, event, active/inactive member distribution
receipts, audit record and attempt completion commit atomically under a fenced
lease. Unavailable/removed recipients remain explicit in the period result.
Current issuer role, plan, client and recipient membership are checked again for
delivery. Emails contain a private workspace report link, not an unapproved
public share. No arbitrary outside email recipient list is accepted.

The **existing** daily `/api/cron/outcomes` route runs outcomes, visibility and
enterprise workers independently under their dark flags. One rejected worker
cannot skip the other two. Individual enterprise jobs are isolated. No new cron
expression is added: deployable Worker config remains daily 04:17 UTC plus Monday
07:47 UTC. Legacy trial-email scheduling remains disabled.

Events are derived idempotently from immutable report/decision/adapter ledgers;
a crash between a business write and discovery cannot silently lose an event.
Webhook endpoints only receive events occurring after endpoint registration.
Outbox creation deduplicates event/target. Fenced attempts (maximum three) retain
started/succeeded/failed/blocked/unknown outcomes. Expired delivery leases become
unknown; an HTTP success without a committed receipt is never durable success.
Unknown/failed/blocked delivery requires explicit manager retry and always uses
the same event ID. Known failed report-generation reads retry with retained
period identity. Pending counts and recent receipts are visible in the workspace.

Webhook requests are HTTPS, pinned to checked public DNS, no redirects, 5-second
bounded requests/responses, at most 32 KiB body and 4 KiB response. Destination URL
(including any secret path/query) is encrypted; lists/audit expose origin only.
Request bodies, provider errors and causes are never logged. Request body hashes
are retained before sending; a changed retry body is blocked. Receivers must
verify signatures and deduplicate event IDs to support at-least-once delivery.

Email uses the Resend `Idempotency-Key` contract with stable delivery ID. The
application uses a conservative 23-hour retry window starting with the first
recorded send, inside the provider's documented 24-hour window. After that,
uncertainty remains explicit and redelivery is stopped. Changed email/body/config
cannot reuse the old key for a different request. See [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).
Configuration errors can be explicitly retried after correction, within the same
attempt and idempotency bounds. No auto resend is performed for uncertain sends.

## Public API v1

Create a client-bound scoped credential in the manager workspace. Secret is
shown once; metadata reads cannot recover it. Current active manager issuer,
active client and Enterprise capability are required on every use. Revocation is
permanent and audited atomically. Credentials are inactive while issuer access or
commercial entitlement is absent; this is distinct from permanent revocation.

Routes:

| Method / resource | Scope | Result |
| --- | --- | --- |
| GET `/api/v1/clients/{id}/outcomes?start=YYYY-MM-DD&end=YYYY-MM-DD` | `outcomes:read` | Stored evidence, current binding, bounded window up to 90 days |
| GET `…/visibility` | `visibility:read` | Bounded closed-loop workspace/evidence |
| GET `…/reports` or `…/reports?id={reportId}` | `reports:read` | Recent 20 private snapshots or exact owned snapshot |
| GET `…/adapters` | `visibility:read`, adapter-bound key | Latest 10 frozen runs for that adapter |
| POST `…/results` | `adapter:write`, adapter-bound key | One idempotent connector result |

Headers: `X-AISO-Key` (credential UUID), `X-AISO-Timestamp` (Unix seconds),
`X-AISO-Nonce` (fresh UUID), `X-AISO-Signature` (lowercase hex HMAC-SHA256).
Sign the UTF-8 string joined by literal newlines:

```text
aiso-api:v1
TIMESTAMP
NONCE
UPPERCASE_METHOD
EXACT_PATH_AND_QUERY
SHA256_HEX_OF_EXACT_UTF8_BODY
```

GET signs an empty body. Timestamp tolerance is ±5 minutes. Nonce retention is
11 minutes, covering a future-skewed request's whole validity interval. Valid
requests consume an atomic 60/minute per-key and 600/minute per-account fixed
minute bucket under the account lock; expired nonce/counter rows are cleaned.
Bad JSON/shape/unknown query parameters are stable 400 before counter/business
writes; oversized bodies return 413. Replay returns 409, rate limit 429, absent
scope 403, opaque invalid credentials 401; dependency errors expose only fixed
codes. A payload cannot select an account. Foreign point reads remain denied.
No API operation bypasses a paid provider quota or invokes an LLM directly.

Private API responses cap at 2.5 MB by dropping older *whole records*, preserving
immutable snapshot content and marking `coverage.responseLimited`. Historical
private report IDs remain readable. Recent list limits/coverage are explicit.

## Signed webhooks

Envelope: `{ id, version: "v1", type, occurredAt, data }`. Event names:
`executive_report.ready`, `workflow.decided`, `adapter.observation`. Payloads contain
owned identifiers/status/hash/provenance, never raw prompts or answers. Headers:
`X-AISO-Event-ID`, `X-AISO-Timestamp`, `X-AISO-Signature`. Signature is HMAC-SHA256:

```text
aiso-webhook:v1
TIMESTAMP
EXACT_UTF8_BODY
```

Reject old timestamps and unsupported version; compare signatures in constant
time; require envelope ID equal header ID; durably deduplicate ID before applying
a receiver side effect. A successful HTTP status means receiver acceptance, not
proof of downstream business processing. See the executable receiver helper in
[`examples/enterprise-connector.mjs`](../../examples/enterprise-connector.mjs).

## Custom adapters and private benchmarks

Register immutable name, exact model label and requested temperature (or explicit
unspecified). No executable customer code, provider URL, secret script or arbitrary
fetch configuration is accepted. Select owned active monitored queries in the
workspace to freeze a `connector.v1` run: question, locale, market, context,
requested model, sampling, domain and created timestamp. A result must match that
run's adapter/query and exact model and have a plausible observation time after
run creation. Runs expire for result writes after 30 days. One sample/query/run;
create another run for another sample.

The external connector uses its own provider credentials outside this server.
`runConnector` in the example accepts an injected collector and a **required
durable retain callback**. Persist each completed observation payload/event UUID
before sending. Retrying a lost API response uses a fresh signature nonce but the
same event UUID/payload; changed replay is 409 and cannot overwrite evidence.
Answers are bounded to 6,000 characters; up to 20 provider citation URLs; 64 KiB
body. `citations: null` means unknown; `[]` means a confirmed empty annotation list.
Citations are retained data, not fetched. No Fimmick model call or automatic
prompt execution occurs in adapter registration/import/submission.

Observations are explicitly `connector_reported`, separate from accepted direct
provider ledger observations. Connector output is not represented as verified
provider execution, grounded retrieval or a classifier-reviewed recommendation.
The executive report surfaces separate connector sample counts.

Benchmarks use only the owning account/client's latest 500 direct and 500
connector observations within 90 days. Group by normalized question, same locale,
actual model, frozen context/sampling, grounding and provenance; market varies.
Citation collection coverage distinguishes unknown from confirmed empty. Display
sample counts and observed citation shares, not causal deltas or guarantees.
Missing required context/model/provenance is excluded explicitly. Repeated source
domains are Fimmick recurrence heuristics, not provider-documented authority.
No cross-account benchmark dataset or data-sharing opt-in is invented.

## Acceptance boundaries

Local synthetic tests cover ownership/foreign denial, application-role grants,
immutable hashes and separation of duties, role CAS/replay, commercial parity,
nonce/rate/revocation, bounded input/output, signed exact bytes, safe rendering in
both locales, durable report/outbox/attempt/lease repair, provider uncertainty,
request-hash/idempotency fences, and connector import with unusable DB/no provider
credentials. Full lint/typecheck/build/unit and Worker gates are required before
PR handoff. Hosted integration/browser checks are reported separately.

Live acceptance still requires Willy's approved migration/deploy, dark-flag
release, explicit manager/approver grants, OAuth property consent, selected owned
analytics/IndexNow setup, webhook receiver and optional email configuration. It
requires separate authorization for paid provider calls or production-like
network allowlist changes. This PR performs none of those live actions.
