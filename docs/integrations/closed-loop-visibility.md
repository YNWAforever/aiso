# Closed-loop AI visibility (roadmap Phase 3)

This extends Phase 2 / PR #113. It measures retained API answer samples, not
consumer search placement. No generated artifact is applied or deployed.

## Schema, entitlement and release

Apply `074_closed_loop_visibility.sql` and
`075_visibility_revalidation_sources.sql` after migrations 071–073, using the
existing guarded migration process. They have only been exercised on fresh
synthetic fixtures by this implementation. No persistent or production database was changed; hosted integration may apply migrations to its disposable test branch.
Neon production identity/role guards remain intact.

Enable `FEATURE_CLOSED_LOOP_VISIBILITY=1` after migration and review. The shared
`closed_loop_visibility` capability permits Pro and Enterprise through the normal
runtime commercial resolver. Other plans cannot call these APIs. Automatic
collection additionally needs the existing `FEATURE_PULSE_ATTEMPTS=1`, configured
Pulse models/allowances and Willy's provider credentials. No credentials or flags
were activated by the implementation. The new provider path also carries the
matching allowlisted OpenRouter error handling from #112; that independent PR
branch is unchanged. Provider bodies and nested causes cannot reach logs or
formatted error responses.

The bilingual workspace is `/{lang}/dashboard/{clientId}/visibility`, linked from
Monitor. GET `/api/clients/{clientId}/visibility` reads owned evidence. POST
`/api/clients/{clientId}/visibility/{action}` supports `queries`, `reviews`,
`drafts`, `automation`, `baseline`, `revalidate` and `retry`. Every action checks
flag, active session, runtime entitlement, client ownership and a byte-bounded
body. The body never selects an account. Mutations repeat ownership in SQL.

## Monitored queries and reproducibility

The existing question bank remains the only question identity. Its nullable
`monitoring` JSON stores persona, intent, funnel stage, branded status, topic,
owned canonical target, priority, expected attributes and owned competitor IDs.
`monitored_queries` is an account-scoped read view rather than a duplicate prompt
store. Priority 1 is highest. Empty competitor selection uses the configured set.
Only active questions are collected. Language and market require explicit
confirmation; they are not inferred from the UI language. Changing them in the
ordinary question editor invalidates old monitoring context until reconfirmed.

New entitled manifests use `2026-10-26.v1`, freeze all query context and competitor
names/aliases/domains, and request temperature 0.2 with one sample per model/run.
The seed is explicitly unknown. Provider sampling implementation and model
outputs can vary; this is reproducible request context, not deterministic output.
Requested and actual model labels and observation timestamps remain separate.
Persona/intent/funnel/topic enter the collection context. Target URLs and the
competitor set do not enter it, avoiding those hints biasing an answer toward
the monitored brand. Existing manifests and their original provider inputs are
unchanged; re-tests copy the entire original manifest.

`ai_observations` reads only accepted tenant-matched attempts from the durable
Pulse ledger. There is no second raw-answer store. Human assessments append to
`visibility_reviews`; they never rewrite provider evidence. Recommendation,
exclusion, message accuracy and risk remain unknown until explicitly reviewed.
Sentiment uses the existing classifier only when its result is classified.

## Measurements and source gaps

Reports include answer presence, provider citation share, first owned citation
in **provider annotation order**, recommendation/exclusion, reviewed accuracy and
risk, sentiment, configured competitor share of voice, context-matched
answer-presence volatility and repeatedly cited source domains. URLs extracted
from answer text never become verified provider citations. Repeated source
frequency is a Fimmick investigation heuristic, not an independent authority
assessment or endorsement.

Presence uses classified accepted answers. Citation share uses recorded
citations; missing envelopes stay unknown. Voice share uses measured brand and
configured competitor mentions. The API exposes these denominators and citation
coverage. Volatility compares adjacent known observations only within identical
question, locale, market, actual model and monitoring context. UI filters apply
to the bounded recent evidence sample, not to an unlimited historical archive.

The workspace reads at most 500 accepted observations, 20 drafts and 30 jobs.
A 2.5 MB response budget can reduce recent collections; it preserves newest
records, recomputes metric denominators and marks the limit. A requested draft is
also shown immediately, including an idempotently returned older artifact.
Historical run snapshots remain in the ledger. Comparison results retain compact
metrics instead of duplicating all source-gap maps.

## Reviewable generation

- Content briefs identify the measured absence or citation gap, frozen query
  context, expected answer attributes and retained provider source domains.
- Schema proposals contain minimal WebPage identity. They invent no FAQ answers,
  reviews, ratings, qualifications or other business facts.
- Technical patches require a bounded inspection to confirm a missing canonical
  on the owned target. The artifact is a real unified diff adding a review head
  fragment. Its integration location is deliberately not guessed from a remote
  site's unknown CMS. It preserves crawler policy and needs human integration.

Drafts are immutable, deduplicated by measured evidence/method, linked to their
accepted observation and returned as review/download material. No apply or deploy
endpoint exists. Assessment notes, reviewer identity and time remain auditable.
Enterprise approval authority is handled separately in Phase 4; Phase 3 does not
mint new approvers or relax the platform-admin grant boundary.

## Deployment and completion loop

Automatic revalidation defaults **off**. Explicit opt-in by an active member
permits future deployments and work-completion events to reserve bounded retests
within the existing Pulse allowance. It does not backfill historical events or
enable another schedule. Already queued Pulse work retains its existing controls.
Manual `revalidate` requests identify an owned deployment or completion event and
use the authenticated member as requester.

A database trigger appends a completion event only when an existing work item
transitions into `done`. Editing it while done does not retrigger collection;
reopening and completing it creates a new event. Deployment records are the
immutable Phase 2 source. Jobs are unique per source event and freeze their
baseline references. A baseline Pulse run must be completed, use the modern
method and same domain, and have **all accepted answers finished before the
event**; starting a run before deployment is insufficient.

The existing daily outcome route discovers future opted-in events, repairs
expired leases, leases bounded jobs and records attempts/results. No additional
Worker cron is configured. Four concurrent bounded page checks fit the request
deadline. Revalidation then reserves an idempotent normal Pulse retest through
the existing quota ledger. The existing Pulse worker owns provider collection,
repair and classification; this worker does not send an LLM request directly.
Waiting jobs poll retained evidence without consuming another site-check attempt.
Incomplete evidence remains pending, limited or blocked, never a positive delta.

Jobs retain interrupted receipts, use lease tokens to fence late/foreign writes,
and allow at most three attempts. Retrying a retained job preserves its reservation
intent. Invalid/no-longer-owned targets and changed authorization block outbound
work. Exhausted jobs remain visible; the UI links to explicit Pulse collection
instead of silently resetting quota/attempt history. Pending evidence after seven
days is recorded as incomplete. Per-feature cron failures do not skip the other
feature's independent work and return a non-success status.

## Minimum Phase 1 prerequisite

Historical scans identify an origin and cannot prove a target page changed.
`visibility-page.v1` therefore captures compact exact-page evidence with no query
strings/fragments: response status, title presence, canonical state, noindex and
a content hash. It retains no HTML or excerpts. HTTPS requests use the existing
public-DNS/pinned-connection SSRF guard, no redirects, a 256 KiB ceiling and a
five-second timeout. Redirected, failed or unsupported responses do not prove
metadata is absent. The observation timestamp is recorded at collection
completion. Before-event page snapshots must predate the event.

Capture a manual baseline before deployment. Opted-in daily collection also
rotates through at most four monitored targets per account when budget remains.
A revalidation checks at most 20 event URLs. Missing baselines, incompatible
methods, changed models/context, incomplete classification/citations or missing
sampling yield explicit non-comparable results and null deltas. No headline
100-point score or historical method is recalibrated. This bounded page identity
prerequisite does not expand into a representative-site crawler.

Page evidence follows account/client retention and cascades with client deletion.
Live acceptance still needs a reviewed release, Willy's provider credentials,
explicit automation opt-in and real before/deployment/after observations. No paid
provider calls, production writes, deployments or secret rotations were performed.
