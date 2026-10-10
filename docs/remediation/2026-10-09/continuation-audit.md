# AISO GEO audit continuation

Audit date: 2026-10-09 Hong Kong. This addendum extends the existing F01–F26 records; their evidence and release gates remain historical records. Source verification, live observations and release acceptance are recorded separately.

## Scope and identity

- Repository: [YNWAforever/aiso](https://github.com/YNWAforever/aiso). Started from existing stacked [PR69](https://github.com/YNWAforever/aiso/pull/69), `55fcabfe3cbfe1cf220c136897252a595c8521fa`, over [PR68](https://github.com/YNWAforever/aiso/pull/68), `8a276a62ec8cd070953bd5c87f85fd88a4481e77`.
- Live AISO: [aiso-kappa.vercel.app](https://aiso-kappa.vercel.app/), deployment `dpl_3u2uYmVaoLGqGCTSWraVfUZXjzJ2`, source `f49e1bd8951394cf88250b3ea88847d0038db491`, verified using Vercel metadata. These local changes are not on that deployment.
- Reference source: [ansvisor/ansvisor](https://github.com/ansvisor/ansvisor), `1ebf69e6f97b1c503b46db95bd20cd877b9fef08`. Reference product: [platform](https://www.ansvisor.com/platform) and an existing authenticated AnsVisor session.
- Work is isolated in a separate clone. The original checkout and read-only synced project files were not changed. No reference source, branding, private account records, prompts, tracking identifiers or session credentials are included in this delivery.
- Verified application/config/test/lock contents are committed at `4f81005a556017ec5064cb55b0b56612e19e179d`. Focused commits are `cd4b9c1` (Pulse/evidence), `99bbb51` (scan/claim/display), and `4f81005` (security dependencies and SDK compatibility). The subsequent evidence commit changes documentation only.

## Findings and repairs

| ID | Severity | Reproduced problem | Repair |
| --- | --- | --- | --- |
| F27 | High | A signed-out owner reopening a saved report receives the claim-intent already-owned response; both sign-in choices were disabled. | Allow ordinary sign-in back to the canonical report without requesting another claim. The server still decides whether the signed-in account owns the full report. |
| F28 | High | A failed claim write spends its one-use intent, so retrying the same intent fails. A successful write with a lost response also made the rightful owner appear to conflict. | Renew the intent through the existing gate for retry. If renewal says already owned, navigate to the canonical result for a fresh server ownership decision. Actual claim conflicts remain conflicts; tokens stay single use. |
| F29 | Medium | The scan form submitted `energy`, while scoring expects `energy_utilities`; energy scans could miss the matching authority pack. | Submit the canonical industry code, checked against the shared industry type, while retaining the translated display label. |
| F30 | Medium | Social preview cards counted raw legacy check statuses as confirmed findings even when evidence was incomplete. | Reuse the same public evidence summary as the result page and explicitly count checks needing evidence. |
| F31 | High | Truncating a citation title at a UTF-16 boundary could split an emoji. PostgreSQL rejects JSONB containing the resulting lone surrogate, preventing accepted evidence from being saved. | Repair malformed Unicode and truncate by code point. An actual local PostgreSQL-compatible JSONB round trip covers emoji boundaries, lone surrogates and control characters. |
| F32 | High | Resuming an immutable Pulse manifest after a plan downgrade could still dispatch models outside the current entitlement. | Re-read the owned active target and current entitlement before dispatch; block disallowed saved items without altering the frozen manifest or historical answers. |
| F33 | High | Repair discovery and the compatibility scheduler/run route could include paused clients. | Require active clients in each producer lookup. |
| F34 | Medium | Legacy/unclassified `brand_mentioned=false` rows could appear as confirmed missed opportunities. | Require classified evidence in both owned workspace loaders before counting a miss. |
| F35 | High | A run could finish collection/classification, fail its final summary write, then disappear from repair discovery forever. | Discover completed runs with missing/stale aggregate summaries. Refresh only the mutable summary generation timestamp after a successful upsert; do not recollect accepted answers or rewrite evidence history. |
| F36 | High | The installed dependency graph contained published security advisories, including critical-rated packages. | Upgrade compatible framework/authentication dependencies and supporting packages; preserve the upstream SDK's compatible dependency graph. Support canonical and legacy OAuth challenge-cookie names across the SDK transition. Fresh installation and production audit pass; F37 remains separate. |
| F37 | High (development tool advisory) | `braces` has an upstream advisory with no published patched version; it propagates through five development-only lint dependency entries. | Open upstream dependency limitation. Production audit has zero findings, but the full graph has five high findings. Do not suppress them or downgrade the framework's lint rules to obtain a misleading zero. See the dependency review for reachability and exact advisory. |

## Alignment with AnsVisor

Authenticated reference inspection covered brand selection, visibility and its formula explanation, prompt lists and raw answers, provider citations, aggregate citation views, observed query fan-out, action KPIs/actions, content opportunities, site audit, traffic setup and reports. Screens with no saved data were recorded as empty states. No paid analysis, report generation, content send, configuration change or tracking installation was performed.

| Product goal observed in the reference | AISO source position and acceptance boundary |
| --- | --- |
| Brand, market and topic context for tracked prompts | Entity/source context and prompt manifests exist in the inherited remediation. Confirm them with genuine owner/reviewer UAT before release. |
| Answers retain platform, time, raw response and source provenance | Existing Pulse ledger plus PR69 citation projection cover model API samples. This continuation repairs storage and entitlement boundaries. These samples do not establish consumer ChatGPT or AI Overview rankings. |
| Mentions, provider citations and coverage are separate measurements | Preserve this separation. Unknown, failed and unclassified evidence must not become zeros or confirmed misses. F30/F34/F35 address related defects. |
| Citation exploration by source/domain/URL and competitor gap | AISO has per-answer evidence after migration060. An aggregate citation explorer remains P01; no parity claim is made. |
| Query fan-out shows searches actually observed during answers | AISO does not yet collect observed search subqueries. This remains P01; generated prompt suggestions are not equivalent evidence. |
| Prioritized actions connect evidence to reviewed work and later observations | Inherited work-item/source approval flows provide the structure. Full live lifecycle, role separation, and outcome comparison remain acceptance gates. |
| Website audit is distinct from AI answer visibility | Preserve readiness wording and failed-scan handling already in PR69; F29/F30 repair scoring input and sharing consistency. |
| AI referral analytics requires a site installation and received events | AISO attribution remains P02/unverified. Neither an uninstalled tracker nor an empty dashboard proves successful ingestion or conversions. |
| Shareable reports and estimated prompt demand | AISO reporting needs normal-session acceptance. No measured demand dataset or equivalent estimator was added in this defect pass. |

## Verification

The baseline freshly executed 5,383 unit tests across 376 files, with no failures or skips. An earlier sandbox invocation failed cache operations before collection and is retained as an invalid attempt, not counted as a product failure or pass.

Focused regressions reproduced the defects before repair. Evidence includes real local PGlite SQL, actual route/component boundaries, owned/foreign controls, and installed Auth SDK contracts. Local database fixtures and SDK mocks do not replace hosted Neon/Auth/provider acceptance.

Final counts, source identity, report hashes and browser observations are recorded in [verification.json](./verification.json). The [dependency review](./dependency-remediation.md) distinguishes package advisories from demonstrated application exploits and separates the root and scheduler toolchains.

| Final gate | Measured result |
| --- | --- |
| Root clean install and complete dependency tree | Both exit 0; 684 installed packages; no peer problems |
| Complete unit suite after final clean install | 5,423 passed across 381 files; zero failed/skipped; exit 0 |
| Root lint and `next typegen` plus TypeScript | Both exit 0 |
| Optimized Next 16.3.8 build | Exit 0; synthetic local-only settings |
| Worker clean install and complete dependency tree | Both exit 0; 79 installed packages; no peer problems |
| Worker tests and TypeScript | 8/8 tests in one file; both commands exit 0 |
| Root production dependency audit | 17 advisory entries before, zero after; final exit 0 |
| Root full dependency audit | Five high development entries remain under F37; exit 1 preserved |
| Worker full and production dependency audits | Both zero; both exit 0 |
| Local browser smoke | English/Chinese readiness copy, canonical energy input, invalid-host rejection, mobile layout, synthetic sample report and console inspection observed successfully |

The local browser ran the optimized candidate at loopback with in-memory fixtures. At a 375×900 viewport, the tested Chinese form's document/client widths were both 360 px, with no horizontal overflow. Both locales selected `energy_utilities`; an invalid single-label host produced an inline error. The sample report explicitly labelled fictional data and did not claim improvement. These bounded observations are not full browser-suite, authenticated dashboard, live scan, database, provider, or human acceptance.

Two new fixture constructors initially failed TypeScript after the framework update because DOM and Next request types differ on nullable signals. They now wrap ordinary `Request` objects in `NextRequest`; the original failure is retained and the final complete typecheck/build pass. Independent code review also found the lost-response claim-retry case; three controls failed before its repair, followed by 125 passing focused tests. No review finding was silently relabelled a pass.

## Release and remaining evidence

- Production remains on the older SHA above. No migration, merge, production deployment, scheduler enablement, provider collection, mail send or role change was performed in this continuation.
- Existing PR69 CI run [37820852994](https://github.com/YNWAforever/aiso/actions/runs/37820852994) passed static/unit/build/Worker and four fixture-browser shards. Integration and aggregate gate failed. Read logs identify `ROLE_ACCEPTANCE_BLOCKED`: a disposable application-role password requires a fresh scoped authorization. The older one-run approval is consumed. Do not suppress that guard or mark the run green.
- The real Neon integration, including migration060 and application-role tenancy assertions, remains required. Local JSONB and ACL tests supplement it.
- Live AISO Google sign-in reached the existing-account chooser. An account choice was requested because three accounts were available; no account was guessed. Authenticated AISO dashboard/renewal/revocation and owner-versus-foreign UAT remain unverified until that flow is completed.
- Follow the existing [rollout and rollback proposal](../2026-10-07/rollout-rollback-proposal.md) with the final reviewed candidate identity. Refresh migration ledger, database binding, runtime role, feature flags, backup and UAT state before proposing an exact release operation. Historical target details are not fresh readback.

The main deployment gap is operationally significant: source repairs in stacked PRs cannot fix the live site until the prerequisite checks and approved rollout occur. The goal is an evidence-backed GEO workflow; full reference feature parity remains additional product work.
