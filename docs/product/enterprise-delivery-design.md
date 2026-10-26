# Phase 4 enterprise delivery decisions

This is stacked after Phase 2 (#113) and Phase 3 (#114). All features default
off until reviewed release; no production deployment, rotation or live provider
call is part of implementation.

## Access and packaging

New capabilities are Enterprise-only, resolved through the shared commercial
catalogue: white-label portals, scheduled executive reports, versioned public API,
webhooks, enterprise workflows, multi-market benchmarks and custom adapters.
`FEATURE_ENTERPRISE_OS` is the dark-release boundary. Existing membership and
legacy feature access remain unchanged.

New enterprise roles are viewer (default), editor and manager. Platform admins
manage grants; no workspace-admin delegation or new owner is invented. Approval
continues to require the existing active platform-managed approver grant and its
event lineage. Enterprise management roles do not themselves mint approval rights.
Mutations append scoped audit events with actor/version references.

## Reporting and publication

Executive snapshots contain bounded stored technical, outcome and AI aggregates,
separate evidence classes, source/method/coverage limits and frozen branding.
They contain no raw prompt/answer/customer-visitor data. They remain immutable.
Public white-label portals show only explicitly approved snapshots through
revocable signed links and recheck current entitlement. Editing branding cannot
silently change previously approved public content. Existing safe logo validation
and proxying are reused.

Schedules use explicit weekly/monthly UTC periods on the existing daily trigger.
They generate private executive snapshots and durable notification/webhook work.
Email distribution is restricted to selected active account-member identities;
no arbitrary external recipient list is inferred. Approval of a schedule covers
that bounded private automation, not automatic publication of future content.
Attempts, leases, duplicate periods, refusals and unknown outcomes remain visible.

## API, webhooks and adapters

Public API v1 uses scoped purpose-encrypted credentials, active issuer/role/plan
checks, bounded bodies, timestamped method/path/body signatures, replay nonces and
atomic per-key/account rate limits. Validation precedes quota and business writes.
No payload can select an account. Foreign clients and resources remain denied.

Webhooks use fixed versioned event envelopes, stable event IDs, encrypted signing
secrets, timestamp signatures and bounded HTTPS requests through the existing
pinned public-DNS guard, with no redirects. Receivers must deduplicate event IDs.
Durable delivery attempts distinguish confirmed delivery, refusal and uncertainty.
No payload, provider error body, credential or nested cause is logged.

Custom adapters use a documented connector contract and frozen owned run
manifests. Customers execute their own providers and submit bounded signed results;
the server does not execute customer JavaScript or fetch arbitrary provider URLs.
Connector-reported provenance remains distinct from direct provider collection.
This adds no paid model call or provider entitlement bypass.

## Benchmarks

The smallest reversible benchmark is private, within the owning account. Compare
markets with explicit model, locale, question/context, sampling and method coverage.
Unsupported comparisons remain limited; descriptive samples are not causal or
ranking guarantees. Cross-account customer-data sharing is not enabled, avoiding
an unapproved privacy/product policy change.

Tests use synthetic fixtures, owned-success/foreign-denial contracts, signature,
nonce, rate-limit, role/approval, immutable snapshot and durable delivery cases.
All local gates and hosted PR checks are reported separately from live acceptance.
