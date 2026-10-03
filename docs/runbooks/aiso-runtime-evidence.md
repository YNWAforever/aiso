# AISO remediation runtime evidence

Recorded 2026-10-03 (Asia/Hong_Kong). This is an evidence register, not production acceptance.

- Audit and fetched origin/main: `f49e1bd8951394cf88250b3ea88847d0038db491`.
- Isolated branch: `codex/aiso-full-remediation-20261003`; original checkout and its untracked plan preserved.
- Original evidence archive: SHA-256 `c8479913f5ca74f476aa6b9d0e78f75cc9c69597a5c82eb0d8378069343218a5`; verified after extraction. Original E01-E20 and R01-R07 remain unchanged in the ignored input directory.
- Node 24.18.0, npm 11.16.0; locked dependency installation exit 0.
- Baseline `npm run lint`, `npm run typecheck`: exit 0. `npm run test:unit`: exit 0, 343 files / 5022 tests, no skips.
- Migration tip: 054. Suggested 055/056/057 are unoccupied at this baseline; no migration applied to any persistent database.
- Neon CLI metadata identifies the configured test project as AISO (`weathered-wave-50814522`), free plan. Runtime target identity, effective role and child-branch cleanup still require in-band readback.

## T00 missing operational evidence

| Evidence | Current conclusion | Required readback |
| --- | --- | --- |
| Current production alias/app SHA | Refreshed: READY production dpl_3u2uYmVaoLGqGCTSWraVfUZXjzJ2, source f49e1bd, alias aiso-kappa.vercel.app | Alias, immutable deployment ID, source SHA |
| Deployed Cloudflare worker | unknown | Deployment ID, deployed APP_BASE_URL override, enabled schedules |
| Persistent schema | Read-only binding: weathered-wave-50814522 / br-square-mountain-az6f82vi / neondb / aeo_app; 52 ledger rows, tip 053; 054–059 absent | Binding/project/branch/role, ledger and concrete column/index/constraint verification |
| Feature flags | unknown | Search Console / Pulse attempts / multi-source values for the target environment |
| Last seven days of jobs | unknown | Last attempt and last complete success, outcome, brand/item coverage, next due time, disabled versus failed |
| Role UAT | blocked live acceptance | Pro role, independent reviewer, account B, new account and nonempty observation fixtures |

Source schedules: Pulse Monday 12:17 HKT, alerts Monday 15:47 HKT, daily trial emails, Search Console and original-run Pulse repair 17:00 HKT. Source default APP_BASE_URL is https://aeo.fimmick.com; it must not be changed based on an unverified deployed override. Empty logs and HTTP 200 cannot prove scheduler health. Google login is already complete and is not the missing gate.

No production Pulse, email, authority elevation, AUDIT-source approval/permission/revocation or AUDIT-draft submission is authorized by these checks. T00 remains 受阻 only for the missing operational acceptance; independent repairs continue.

## Evidence and rollback

Full local logs: ignored `.superpowers/aiso-remediation/baseline-*.log`; defect and repair logs: ignored `artifacts/aiso/Txx/`. Task and acceptance CSVs under `docs/aiso-remediation` retain the original IDs. Each repair records its source SHA separately from later evidence-only commits. Roll back source changes by reverting the corresponding task commit; preserve historical data and approval decisions.

## T00 read-only refresh, 2026-10-03 10:21 HKT

Vercel production is READY at the original SHA, not this candidate. The configured production DATABASE_URL answered the expected project/branch/role in-band before aggregate reads. Its ledger has 52 rows ending at `053_client_domain_verification.sql`; repository migration054 is also absent, so deployment must inspect the entire pending set054–059. No ledger baseline or migration was applied. Read-only seven-day `cron_runs` aggregate returned zero rows; Vercel grouped cron runtime logs returned zero groups. Both are unknown coverage, not healthy jobs or proof of disabled schedules. No customer rows, raw answers, tokens or error details were read. Sanitized identity/schema/job aggregate is `artifacts/aiso/T17/runtime-readonly.json`.

The source AISO worker has no schedules; the legacy source worker has three schedules and a different default origin. Actual deployed overrides/version/flags remain unverified. T00 stays受阻. Google login remains completed in the original audit.
