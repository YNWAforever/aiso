# Conversation Studio Stage B1

This increment replaces Stage A's fixed demo reply with deterministic summaries
and excerpts from already saved brand evidence. It makes no model or live data
provider call. It creates no thread endpoint, storage or migration.

Base: `main@f91cc63eb41466250a281d7a062cd21d939c8899` (#112, following
Stage A #117). Approved scope: Willy via Rio t66s443, 2026-10-28 HKT.

## Page and data boundary

The existing `/{lang}/dashboard/{clientId}/studio` page still requires a session,
checks the server flag, validates the brand UUID, and checks ownership using the
session's `account_id`. Only then does it call `loadStudioEvidence`. No new API
route is introduced, so there is no message payload or input-validation route.

The reader reuses `loadObservationSnapshot` and `loadObservationDetail`, including
their canonical-run scope, historical classification rules, public URL validator,
provider-citation normalization and saved search-execution projection. It reads
at most eight observations from the latest retained canonical Pulse week. It
passes at most 900 Unicode code points of answer text and five safe saved links
per observation to the client. Excerpts are visibly labelled historical model
output, not independently verified facts; dates, model and market remain unknown
when unrecorded. Text links are labelled separately from provider citations.

The latest owned scan is read with **both** scan and client `account_id` filters.
`buildOwnedResultEvidence` validates the saved envelope and applies the existing
factual-density projection. The UI reuses `ScanEvidencePanel`. Unsupported or
legacy envelopes without valid evidence do not become invented scan findings.
No full scan payload, provider receipt or brand snapshot is sent to the browser.

The snapshot is bounded and page-load only, not a complete history or a live
stream. It states the selected week, recorded-row count and truncation. Reload
reads newer evidence and clears the temporary conversation. A DB read failure
shows the page's translated unavailable/retry state; it does not masquerade as
an empty evidence set. The separate read statements are not a transactional
cross-source snapshot; records can change between reads.

## Replies and evidence panel

Send composes a local saved-record reply. Messages never leave component state.
Brief and report templates include saved observations and scan checks; the Pulse
template includes observations only. An evidenced state requires a classified
answer excerpt or a complete, assessed scan check appropriate to the template.
Partial or missing evidence remains visible. No rankings, market-wide rates or
new recommendations are generated.

Freeform input uses simple keyword matching against the loaded questions and
excerpts, including Chinese bigrams. Matching is only retrieval, so these replies
always state that there is not enough evidence to verify the question's answer.
Competitor templates also remain insufficient for a verified comparison, showing
saved context without inventing rankings. Editing a template clears its intent.

Every assistant reply includes expandable steps, coverage and sources. Source
entries include observation/scan IDs, dates and safe saved URLs when present.
Coverage is `present`, `missing` or `unsupported`: presence means included saved
records, not complete support; missing means absent from the bounded selection,
never zero mentions. Saved citation links do not prove that search executed.

The panel follows the supplied prototype's steps/sources information architecture.
The prototype URL was inaccessible here, so this does not claim a pixel match or
that the prototype's live sources run. OpenRouter, DataForSEO, Firecrawl and GSC
are never queried by Studio. Static labels explicitly say no GSC HK filter/PT
bounds apply and DataForSEO ChatGPT LLM Mentions US/EN coverage does not establish
HK/zh-HK support. Empty/unqueried Mentions is never interpreted as zero.

## Flag, navigation and release boundary

`FEATURE_CONVERSATION_STUDIO === '1'` is still the only enabling value. The flag
defaults OFF; no environment settings are changed. **Production stays OFF.**
`vercel.json` disables Git deployment for exactly
`codex/conversation-studio-stage-b`. This work ends at a draft PR and CI, without
deploying, enabling Production, or merging.

WorkspaceHome at `?step=home`, existing navigation and tools remain unchanged.
Threads, per-thread drafts and replies stay in memory; changing brands remounts
the component. There is no durable privacy/ACL or sharing claim.

Out of scope: B2 paid/live grounding, Stage C opportunities/work-item saves,
Stage D collaboration/persistence/Neon thread schema, Production flag ON,
onboarding brand_draft, billing, entitlements, cron and MCP. No CI provider spend.

## Verification

- Pure reply tests: empty evidence, incomplete classifications, missing citations,
  unsupported freeform/comparison claims, and scan-versus-Pulse scope.
- Reader/page tests: exact flag behavior, auth, UUID, ownership-before-evidence,
  safe bounded DTO, deleted records, invalid envelopes, and unavailable states.
- Local PGlite integration: production observation/detail/scan SQL, owned success,
  foreign denial, mismatched scan-account denial, safe citations and unknown
  search execution. Fetch is blocked. These are synthetic local SQL fixtures,
  not hosted authentication or a production database acceptance run.
- Both locale catalogues render production components. Playwright extends the
  existing offline component fixture and records/blocks all outbound requests
  while testing Send, excerpts, sources, all templates, insufficient states,
  IME, draft isolation, reload reset, mobile reflow and axe accessibility.
- Run `npm run lint`, `npm run typecheck`, `CI=1 npm run test:unit -- --maxWorkers=3`,
  `npm run build`, and the focused Studio Playwright spec. Hosted PR gate remains
  the evidence for the broader integration/E2E/build/Worker matrix.
