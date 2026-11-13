# SME execution acceptance

This records the acceptance boundaries for the [five execution slices](./sme-execution-workflow.md): save a draft, review a frozen version, choose how to deliver it, distinguish a receipt from a live check, and read stored comparisons.

## Pre-gate checkpoint

This matrix was prepared after the draft, independent-review, delivery and verification/outcome slices were released as [#260](https://github.com/YNWAforever/aiso/pull/260), [#261](https://github.com/YNWAforever/aiso/pull/261), [#262](https://github.com/YNWAforever/aiso/pull/262) and [#263](https://github.com/YNWAforever/aiso/pull/263). The acceptance slice then added seven disposable-Postgres export-receipt cases.

At that checkpoint the seven cases were authored and typechecked, with targeted lint passing; database execution had not been claimed. Actual execution must be established by the acceptance PR's mandatory integration result rather than inferred from test collection or a skipped suite. The final release receipt belongs to that PR's checks and post-merge canonical evidence.

## Behaviour matrix

| Area | Required behaviour | Evidence and boundary |
| --- | --- | --- |
| Entry and resume | Saved Tasks and retained Opportunities offer an appropriate next step without manufacturing saved work. | Home, monitoring, Studio, Tasks and Opportunities fixture regressions; guarded canonical reads establish the actual available entry/empty states. |
| Frozen package | V1 and V2 retain their saved title, action, notes, edit specification and complete ordered evidence, including repeated snapshots. | Real freezers, DTO parsers and renderer contracts; changes to current evidence do not rewrite a frozen version. |
| Independent review | Choose a decision explicitly; retain the submitted reason and request identity across uncertain retries; older reads cannot erase an accepted decision. | Mounted review tests, service contracts and disposable database constraints. A fixture reviewer does not establish that an eligible second person exists in a production account. |
| Export | Preserve the six V1 byte/hash goldens; V2 exports retain the full package. A failed receipt write cannot return successful export bytes. | Pure renderer and service tests; the new disposable cases join the actual retained-row reader, renderer and app-role receipt store. They do not call a production export URL. |
| Receipt persistence | Record V1/V2 JSON and text exports, the actual downloader, exact tenant/version/content/artifact bindings and precise UTC time. Repeated downloads remain separate events; receipt schema 1 is independent of renderer v1/v2. | The mandatory integration gate must execute all seven app-role Postgres cases. Wrong scope/hash must write zero rows; UPDATE/DELETE must fail with 42501. Exports must create no delivery attestation. |
| Manual delivery | Preserve destination, UTC date, note, withdrawal target/reason and normalized retry identity through background refreshes and path changes. | Actual mounted workspace tests. Manual records remain self-reported; a point-in-time check cannot relabel an existing manual history event. |
| Developer handoff | An uncertain send requires reconciliation. Unknown never grants resend. Retry requires fresh server authority; double dispatch sends once. | Mounted network/malformed/refusal, cooldown and scoped late-completion cases. These do not send a real developer job or consume a production quota. |
| Live check | A completion receipt is the executor's claim; a saved check is a point-in-time observation. Removal uses absence semantics. c4 is displayed but does not gate matching. | Actual receipt/check DTOs, precise stored timestamps and actual delivery-event provenance. A match does not establish permanent publication or commercial impact. |
| Refresh propagation | A first nonempty receipt/check read and accepted member check invalidate the appropriate saved reads. Empty/identical/capability-only reads do not create loops. | Deterministically staged initial reads and mounted parent composition; scope/generation guards reject older reads and mutation completions. |
| Stored outcomes | Show comparison basis, movement, baseline/observation results, timing, limits and provisional status together. Missing is not zero; Pulse is unranked. | Real outcome evaluator/parser fixtures and mounted comparisons. D7/D28/D56 are stored-evidence windows, not scheduled collections. |
| Unsupported package | V2 comparisons remain explicitly unsupported, including a V2 package with only one saved source. Preserve 401/403 instead of disguising them as unsupported data. | Genuine single/multiple-source V2 fixtures with the actual unavailable/auth response shapes; no first-source downgrade. |
| Layout and interaction | en/zh-HK, light/dark and 320/390/768/1440 widths; native keyboard disclosures, 44px controls, no horizontal reflow or axe violations. Parent review/preparation/history keeps its primary action. | Production CSS plus hydrated actual workspace fixtures; bounded representative screenshots need visual inspection. |
| Existing boundaries | Preserve ownership, membership, entitlement, independent approval, paid-workload, configuration and schedule gates. Expert Studio/MCP/skill controls remain available through the established workflow. | Unchanged public routes/schema/contracts, full unit and mandatory CI gates, and the retained Home/Studio regression scopes. No provider, role, schedule or production-token setup is performed for this acceptance. |

## Evidence layers

Fixture browser evidence establishes rendering and interaction against controlled, scope-bound responses. It does not establish production database persistence, provider execution, account readiness or representative SME usability. Disposable Postgres evidence establishes only the exercised database paths on the exact role-verified test branch. Source inspection and discovery counts are recorded separately from executed tests.

Canonical acceptance uses the owned account and an explicit safe-read allowlist. Blocking non-GET requests alone is insufficient because approved-package GET exports write audit receipts. Production acceptance does not create drafts, decisions, exports, handoffs, checks, measurements, tokens or configuration for a demonstration. An empty saved-work list remains empty and is reported as such.

## Executed local acceptance

After merging the exact released verification head, local lint completed with zero errors/warnings, Next type generation/TypeScript and the text audit passed, and the production build succeeded. Actual execution passed **9,056 unit tests / 15 existing local skips**, **285 fixture-generation tests in 27 files**, and **1,180 scoped Chromium/mobile browser cases** with zero skipped/flaky/unexpected results. All eight representative fixture image hashes match the inspected verification images. This local gate does not execute the seven exact-target Postgres cases; their required CI receipt remains a separate evidence layer.

## Release receipts

The acceptance PR's checks and post-merge release comment are the final record of its tested head, full unit/static/build results, actual fixture generation/browser statistics, independent-review disposition, mandatory database execution, all required CI job results, matched-head merge SHA, exact canonical Ready deployment and production schema-gate line. The guarded canonical summary and inspected screenshots accompany that receipt. This pre-gate matrix defines what must be established and keeps populated fixture evidence distinct from production states that were actually available.

The preceding verification release is recorded at [#263's release receipt](https://github.com/YNWAforever/aiso/pull/263#issuecomment-6865939179): tested head `9f7cb4a9d69c35b1b81027dc4b535aaf4aa1c862`, merge `8ffdbb4d21f234da9b3facca2007f3b0f3d4fc1c`, CI `43509712044` with all ten jobs successful, canonical Ready `dpl_AM4yP7WidEBS423KqeDurEMhJYvj` with 107 shipped migrations recorded, and 36 guarded canonical cases / zero write attempts. Its populated fixture evidence and empty production Tasks state are explicitly separate.
