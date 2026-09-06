# Feature contract

Frozen from base plan §10.1, 2026-08-31. Changes require a plan amendment, not a silent edit
here.

## Feature matrix

Status: `live` · `partial` · `fixture` · `roadmap` · `absent`.

| Feature | `aiso` status | Donor treatment | Target classification | Phase |
|---|---|---|---|---|
| Public URL scan | live | deterministic local stages | port-onto-data | 3 |
| Scan → sign-up claim | live (`claim-intent` + `claim`, signed cookie) | auth handoff dialog | port-onto-data | 3 |
| 20 deterministic checks | live | fixed ledger | reuse engine, restyle presentation | 3 |
| Grade + headline score | live | coverage-gated | reuse; add coverage display | 3 |
| Diagnostic pillars | **partial — not persisted** | coverage-gated model | fix + version (ADR-6) | 0/3 |
| Evidence per check | **absent** | rich evidence UX | new-schema | 3 |
| Bounded multi-page crawl | absent | scope preview UI | roadmap → defer | 5+ |
| Brand/product/entity discovery | absent | full fixture | new-schema | 5 |
| Demand/query/intent model | partial (`prompt_bank`, 4 categories) | question panel QP-1.2 | extend | 5 |
| Search observations | absent | fixture | defer (needs GSC) | 6 |
| AI observations | partial (`pulse_metrics`) | sampled fixture | extend | 5 |
| Sources / citations / page graph | partial (`ai_citation_log`, `lib/authority`) | fixture | extend + new | 5 |
| Product truth / claim conflicts | absent | `claims` fixture | new-schema | 5 |
| Opportunity prioritisation | partial (`agent_recommendations`) | unified board | adapter + extend | 5 |
| Change sets / diffs / validation | partial (`fix_packs`) | versioned diff | new-schema | 5 |
| Approvals + audit | absent | guarded state machine | new-schema | 5 |
| Export / delivery attestation | partial (CSV export) | export confirmation | new-schema | 5 |
| Recheck / outcome windows / proof | absent | D7/D28/D56 | new-schema | 5 |
| Fix Pack / cluster map / content brief | live | local diff | port-onto-data | 4 |
| AI Pulse | live but **never produced a row** | sampled fixture | port-onto-data; empty state first-class | 4 |
| Prompt bank | live | QP-1.2 fixture | port-onto-data | 4 |
| Competitors | live | fictional | port-onto-data | 4 |
| Agents | live | — | reuse | 4 |
| Alerts + notifications | live | local cards | port-onto-data | 4 |
| Local Trust | live | — | restyle | 4 |
| Onboarding | live | first-use journey | restyle | 4 |
| Auth / workspace ownership | live | no fake login | reuse | 4 |
| Roles beyond owner/admin | **absent** | 7-role matrix proposed | defer — needs decision | 5+ |
| Plans / trials / entitlements / quotas | live | disabled | reuse | 4 |
| Stripe checkout / portal / webhook | live | disabled | reuse | 4 |
| Client reports + share links + branding | live | lifecycle fixture | port-onto-data | 4 |
| AI report summaries | live | — | reuse | 4 |
| GSC / Bing / IndexNow / analytics / logs / CMS | absent | release-state catalogue | roadmap | 6 |
| Bilingual en / zh-HK | live (883 leaf keys each) | hard-coded tuples | port to `messages/*` | 2 |
| Agency portfolio | partial | fixture | port-onto-data | 4 |

## C9a amendment — 2026-09-06

Private entity organizational records and aliases are implemented locally for existing owned clients, one canonical brand record per client. Public discovery/verified entities, products/sub-entities, new approval roles, delivery attestations and outcome attribution remain outside this vertical. Migration040 is authored locally; no live feature availability is inferred before migration/activation approval.

## C9b amendment — 2026-09-06

Private monitored questions and retained AI observations are implemented locally for existing owned clients at `/[lang]/dashboard/[clientId]/observations` and `GET /api/clients/[clientId]/observations`. This extends the existing partial `pulse_metrics` source into an authenticated, account-scoped read projection; it does not make search observations available or claim an immutable provider-attempt ledger. Raw answers remain private to the source query, legacy collection/model/market provenance remains unknown, and current prompt metadata is labelled separately from historical observation text. No entity row, paid read entitlement, schema migration, provider call, collection change, public verification, backfill or new KPI is introduced. Live Neon equivalence and provider behavior remain unproved by this local checkpoint.
## C9c evidence-linked drafts — 2026-09-06

C9c is locally complete for private, draft-only work derived deterministically from retained Pulse brand-absence evidence and the newest scan's validated check gaps. Existing account members can view suggestions and explicitly save/edit organizational drafts. Viewing is side-effect-free; no approval, role assignment, delivery, publication, dismissal/archive, outcome or impact-attribution lifecycle is introduced. Existing paid generation, prompt-write, recommendation-read and provider gates are unchanged.

The release source contract is `pulse-brand-absent.v1 | scan-check-gap.v1`, with public source state limited to `pulse | scan`. Recommendation-derived drafts are deferred by the user's finish scope and are neither implemented nor a pending C9c decision. The additive migration may reserve `agent-recommendation`, but application reads/writes reject or exclude it.

Migration `041_evidence_work_items.sql` is authored and unapplied. Activation remains a separate external gate requiring an exact target, SQL/application SHA review, application-role validation and approved rollback. Local mocks and browser fixtures prove application behavior only; live PostgreSQL concurrency, grants, schema state, real authentication, providers and customer data remain unverified.

Source rollback may remove C9c routes, navigation, services, components and tests while retaining C9b observations. If schema/data is ever activated, rollback disables the C9c application surface while retaining the additive table and saved drafts; customer evidence is not dropped.

## C9d immutable review and audited approvers — 2026-09-07

C9d adds locally implemented immutable versions alongside the unchanged C9c draft API. Members submit an exact saved revision; the server freezes allowlisted content/evidence and deterministic validation. Draft editing remains separate. Only the latest version can receive one terminal Approve or Request changes decision from a currently designated account approver who did not submit it.

Existing platform admins manage designated approvers for an explicit account through an independently guarded API. Grants/revocations use optimistic revisions and immutable audit events; admin status does not grant review authority or bypass client ownership. DTOs omit email/auth/account internals. Routes fail closed with stable no-store errors and preserve 201-new/200-identical replay semantics.

This local checkpoint does not apply migration 042, grant a live role, write customer data, deliver/publish content, establish factual or regulatory approval, or prove impact. Live PostgreSQL constraints, grants, rollback and concurrency remain a separate exact-target gate. Recommendation sources, general roles, invitations/account reassignment, delivery attestations and outcome windows remain outside C9d.
