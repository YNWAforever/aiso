# Roadmap phases 2–4 delivery

This implements §6 of [the product roadmap](geo-aeo-seo-roadmap.md), subject to
its evidence, packaging and safety constraints. Code completion and synthetic
verification do not establish production OAuth, collection or deployment.

## Inventory and approach

The existing Google OAuth flow encrypts account-bound refresh tokens, verifies
property eligibility and records sync outcomes. Pulse already preserves frozen
prompt context, attempts, provider citations and classification. Work items have
versioned review, delivery attestations and outcome windows. Reports already have
immutable snapshots, explicit publication and revocable links.

Extend those components with additive migrations and explicit capabilities in
the plan catalogue. Keep the 100-point score and historical evidence unchanged.
Phase 2 starts from main; Phase 3 and Phase 4 will be stacked in that order.
PR #112 remains independent and untouched. New logs follow its allowlisted
diagnostic approach. The sole writer implements and reviews this sequence.

## Phase 2: outcome integrations

- Extend Search Console with search-appearance records and explicit query/page
  cluster attribution. Retain the existing account-bound OAuth and sync ledgers.
- Use the provider-documented IndexNow protocol for Bing/participating-engine
  update signals: owned URLs, same-origin key-file verification, bounded batches,
  durable submission receipts and explicit accepted/failed/unknown states.
  Acceptance of a URL does not prove indexing or ranking.
- Provide signed, bounded, replay-resistant first-party analytics ingestion.
  Store compact page/query counts and conversion values, not visitor identifiers,
  cookies, full request logs or arbitrary metadata. Scope comes from the
  credential rather than a payload account identifier.
- An optional compact crawler-event adapter must distinguish owner-reported
  activity from verified provider-IP evidence; a spoofed user agent cannot prove
  retrieval. Unavailable verification stays unknown.
- Record deployments, before/after observations and regression evaluations in
  account/client-scoped ledgers. Comparisons are observed associations with
  explicit sample/method limits, never claims of causation.
- Show technical readiness, observed retrieval and observed outcomes separately
  in an owned bilingual workspace and the monitoring surfaces.
- Reuse the two approved Worker triggers; do not enable the disabled email
  trigger or deploy any Worker as part of implementation.

## Phase 3: closed-loop visibility

- Extend the existing prompt bank/run manifest with query intent, persona,
  funnel, topic, target, priority and sampling. Preserve historical snapshots.
- Build observation projections from accepted attempts and provider citations;
  retain unknown sentiment/accuracy/recommendation states instead of inventing
  measurements. Competitor sets are account-owned configuration.
- Extend citation gap maps and create reviewable briefs/schema/technical drafts
  linked to measured evidence and the existing work-item approval lifecycle.
- Queue explicit, bounded re-validation/retests after recorded deployment or
  work completion. Preserve before/after context and require comparable samples.
  No generated patch is applied or deployed automatically.

## Phase 4: enterprise operation

- Add white-label portals over explicitly published snapshots, revocable access,
  scheduled executive snapshots and durable delivery receipts.
- Add versioned account-scoped public API credentials, rate limits, signed
  webhooks and bounded delivery attempts with visible unknown outcomes.
- Extend role workflows and audit logs without implicitly minting an owner or
  relaxing the existing platform-admin approver grant boundary. The role-grant
  authority choice has been raised with Willy and remains pending.
- Add context-compatible multi-market benchmarks and documented custom adapter
  contracts. Cross-account benchmark sharing requires explicit opt-in; private
  customer evidence is not a default shared dataset.

## Verification and release boundary

Use unit/contract tests, real SQL on fresh synthetic fixtures, owned-success and
foreign-denial cases, bilingual rendering, lint, typecheck, production build and
Worker tests. Run no paid provider calls, production writes, deployments,
network-allowlist edits or secret rotations. Keep the Neon binding guard and
application role expectations unchanged. Document migrations, entitlement keys,
configuration, live acceptance still required and PR tip evidence per phase.

Provider facts: Search Console discovery revision `20260805` documents the
`searchAppearance` grouping; Microsoft's
[IndexNow plugin](https://github.com/microsoft/indexnow-wordpress-plugin)
documents `https://api.indexnow.org/indexnow` and explicitly says submission does
not guarantee indexing. Thresholds, cluster matching and prioritisation remain
labelled Fimmick heuristics.
