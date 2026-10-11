# Release validation — 2026-10-12

The original12-task implementation is on main through PR86. PR88 was normally merged after all required checks and review passed; latest tested application source is c7b3b7c9971c0e684c6b7aa97b3ae62f4b36cc27. No finding is verified_live. The original checkout and all2026-10-11 records remain unchanged.

The isolated acceptance gate is now green: UC01–UC13 applicable fixture scenarios passed with real managed Neon Auth, real tagged-template application SQL, two different accounts and a protected Vercel preview. Only provider transport is synthetic. See finding-status.csv, uc-results.csv and release-evidence.json for the individual F/T/UC states and evidence hashes.

| Gate | Current evidence | Release state |
| --- | --- | --- |
| Application regression | 5,968 unit /0 failed /0 skipped, CI network guard explicitly enabled; lint/typecheck pass | Local passed; new exact-head CI required |
| Auth / tenant | Real sign-in/session/provisioning,18 owned/foreign pairs, anonymous401, real revocation401 and restored200 | passed_preview_synthetic |
| Browser | 47/47, EN/zh-HK,360/390/1440; recovery creates one brand after500/network/reload | passed_preview_synthetic |
| Migration063–070 | Exact eight checksums rehearsed and read back on empty isolated schema; app grants separately verified | Isolated passed; production unchanged through062 |
| Formal database preflight | Actual local app/owner credentials resolve to the expected AISO server; ledger61 rows; zero duplicate weeks/orphan runs; old canonical unique constraint present | READ_ONLY passed; deployed Vercel DSN still needs runtime attestation |
| Worker |11 tests/typecheck; dedicated two-cron bundle and Pulse-only pause dry-run; downloaded current script; actual bundled scheduled handler calls hosted isolated app200/200 and preserves40 collection attempts | Ready for scoped publication; no hosted Cloudflare invocation |
| Provider |6 requested models each have nonempty endpoints via GET200; Haiku4-5 alias is valid | Metadata passed; zero paid POSTs |
| Production backup/restore |6h retention observed; no fresh backup or restore exercise | Required before DDL |

UC03 injected nine synthetic classification faults and observed31/40 partial with readable raw answers. UC04 restored40/40 without replacing accepted raw answers or adding collection attempts. UC11's same-week retest used separate identity/frozen scope and left canonical weekly digest206dc4161bfd7ce8467041c1a65f2ec88319b5e16e99ed640bf34a7871244ede unchanged. UC06 retained unknown search execution even when native/web search was requested and citations existed.

Failures are preserved in ignored private artifacts: managed Auth provisioning409/412 in unused empty alternatives; missing SQL transport allowance; negative-classification fixture error; response-wrapper/pagination assertions; route-announcer selector; correct3-brand Pro denial; no-op batch retaining its version; role impersonation42501; first packet test import path; malformed project identifier boundary RED. Each corrected execution has a separate receipt. A failed invocation or unexercised scope is never counted as pass.

The new eight-file release runner defaults to BEGIN READ ONLY. It requires exact schema/ledger/file hashes, the existing ledger and exactly063–070 pending. --apply additionally requires a fresh hash-bound human authorization, same-target backup/restore receipt, deployed runtime binding receipt and an exclusive retained claim. Each migration and ledger row commit together. Any unknown/partial outcome stops execution for read-only reconciliation. It does not baseline, drop schemas, rebuild Auth or grant an administrator.

Private targets, passwords, sessions and raw receipts stay in ignored artifacts/release-20261012 and .auth. Public fixture bindings identify only disposable synthetic resources. The preview archive contains a documented test-only instrumentation overlay; the application repository does not import it. It refuses production, foreign Neon targets, owner credentials and a paid provider key. No guard or Vercel protection was disabled.

Remaining production NO_GO: deployed app→Neon identity/role attestation; fresh backup/restore; approved exact migration application/grant readback; hosted Worker receipt and producer inventory; bounded real-provider cost/search evidence; human Google/magic-link UAT. The follow-up audit's F57 administrator designation, F58 suggestion-drawer accessibility and primary project Preview F59 are separate outstanding scopes; this alternate protected preview does not repair F59's configuration. F55 context recovery now has additional hosted synthetic evidence; F56 has local/CI evidence, not hosted admin acceptance. Root development dependency finding F37 remains documented; production/Worker dependency scans were separately clean in the previous release.

The final confirmation package binds the actual targets, hashes, commands, stop conditions and rollback. Global Pulse activation and all customer email/payment/CMS/n8n actions stay outside a limited provider canary approval.
