# Separate self-review of the final remediation scope

Selected implementation: `fbf8f9d209edf5ce47fc01d979c167371ffa2c76`. Single-agent review follows the session's explicit delegation restriction. Existing T01–T20 code and T22 authentication repair were reused; no auth code, dependencies or migrations were rewritten.

## Findings resolved during review

- T21 originally used source creation as approval. It now takes the minimum real version `approved_at`, joining source/version ownership by source, account and client. Both account filters are present. It retains the historical event across repeated/later approvals, a newer unapproved version and withdrawal. It does not enable agent use. Four genuine disposable-DB regressions passed after the defect was reproduced. An early wrong join column was caught by DB execution and corrected before the passing run.
- T23's old provider fallback produced `50` and malformed values could become NaN. The strict parser and bounded response schema require an integer 0–100 and a bounded array of nonblank strings. Full JSON parsing rejects embedded prose, coercion and malformed data. Outages/invalid payloads preserve deterministic page counts with nullable scores, partial diagnostic evidence and a neutral presentation. Valid observed 0/50/100 values remain observations, not proof of search or consumer exposure.
- September 5 and October 3 scanner registries remain explicit before the October 7 bump. Reader tests preserve historical envelopes and signatures and reject unknown registries. Read projections exclude old unprovenanced C18 from priorities/impact without rewriting historical scores or stored envelopes.
- Review found that the owner disclosure could still say complete after excluding C18. A failing regression now proves its collection becomes partial and limited while stored collection/signature remain unchanged.
- E37 review found unsupported platform-weighting/chunking claims in the GEO cards. Bilingual copy now identifies AISO's local authority, sitemap and chunk heuristics and says actual citations/search visibility are not measured. Scoring formulas were retained.
- Actual worktree Playwright discovery initially found zero tests because a broad ancestor `.worktrees` exclusion matched the active checkout. Existing discovery tests reproduced it. Exclusions now target only nested directories within the current checkout; actual discovery found 902 tests in 32 files. Required Auth and live-scan prerequisites remain intact.
- New CI/browser evidence exposed a current fixture without explicit provider provenance and a genuine non-applicability projection fault. The fixture now declares a synthetic current observation; the projection preserves a check explicitly marked not-applicable in both applicability and assessment. The meaningful new regression failed before the one-line repair. All 24 affected unit checks passed afterward. Legacy/unavailable behavior was retained.

## Boundaries retained

- T22/T14 SDK and transport contracts pass in fixtures. No remaining auth code fault was reproduced. The pathname-based refresh is not evidence for indefinite same-path/API-only renewal. Real issuer, human session, expiry/renewal and revoked-role boundaries remain unverified.
- Owner-role tenant fixtures never substitute for `aeo_app` acceptance. The default role hook and the ten-suite exact-target wrapper keep their explicit authorization guards. No approval flag was self-set and no existing role was changed.
- No production source activation/revocation, paid provider request, email, production migration, merge/deploy, job enablement or content cleanup was executed. The Worker remains disabled. Missing app-bound DB/role/flags and successful scheduling coverage remain unknown.
- All historical task/finding/case/operation IDs and fields are retained. New execution fields and immutable input copies are separate. Counts come from actual reports; skipped assertions, failed hooks, zero discovery and absent reports are never passes.

Use the execution ledger, command receipts and rollout proposal for the final measured gates. The remaining external acceptance is not closed by this review.

## Approved CI evidence follow-up

The subsequent explicit one-run approval has been executed at d0b12b6 and all actual reports read. Default DB passed 221/221, including all 22 application-role assertions; all ten exact-target configurations passed 178/178 with feature-store-tenancy included. No required test failed or skipped. Four browser reports passed 902/902 without flaky results or global errors; unit passed 5,345/5,345. Registered fresh-child provenance, resolver `manual-run`, successful command steps, logged deletions and independent post-run absence agree. The persistent repository approval variable remained absent. No implementation fault reproduced, so no source change or additional tests were introduced for this documentation update.

The six execution CSVs preserve all IDs, row order and historical fields. Only T16/T17 active isolated results/blockers and AC20/AC21/AC35 active blockers were superseded, with their exact previous values retained in appended columns. Existing CI run objects compare unchanged against d0b12b6. Source fingerprint verification covers 1,128 files; structured-report/hash validation is recorded separately. Required normal-session/production/scheduling acceptance remains open. The one-time permission cannot be reused by a later documentation-only head.
