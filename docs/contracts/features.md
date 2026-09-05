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
