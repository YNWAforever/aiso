# Isolated UAT setup execution — 2026-10-07

The user’s subsequent `continue` authorized the concrete isolated setup in `artifacts/aiso/2026-10-07/uat-follow-up/isolated-preview-proposal.md`, SHA-256 `e57d2ab272c81bc7509a79a80428a69084bca9fa12c6cdcccdedb733e9081f40`. That historical proposal remains unchanged. The authorized fresh setup has now executed; normal-session acceptance remains open. No additional disposable-role CI run or production operation was authorized or performed.

The final protected [UAT Preview](https://aiso-remediation-uat-20261007-git-edd2cd-ynwaforevers-projects.vercel.app) serves pinned application SHA `d1aecceb3f0680d4e03b7aad9dd2f84f9b5ac9cb`. Operator compatibility commit `a6c2f2c258951f9feef75fa621f1918a6ab9d5cd` changes only `scripts/readiness/candidate-contract.mjs` and its tests: standard Vercel Preview metadata may use API target `staging` or historical `null`, while named custom environments remain rejected. Team/project/deployment/READY/SHA/origin checks remain enforced. All app, lib, components, messages, supabase and cloudflare Git trees match the deployed d1 SHA; the exact tree IDs are in `evidence/uat-execution/source-drift.json`. This new operator commit has not been deployed. No third build is authorized.

## Actual registered targets

| Resource | Verified isolated identity |
|---|---|
| Neon project / organization | `nameless-term-06793418` / `org-soft-sunset-25251479` |
| Neon creation / region / version | 2026-10-07 13:10:59 UTC / AWS Singapore / PostgreSQL 18 |
| Root branch / endpoint | `br-ancient-glitter-b34yew8s` / `ep-soft-bird-b3lqgjne` |
| DB / runtime role | `neondb` / `aeo_app`; actual runtime identity observed |
| Compute | fixed 0.25 CU; Free default suspension 300 seconds; stored timeout `0` |
| Managed Auth | Better Auth, provider project `c617a7ce-2168-470e-9e4e-22860034fa9d`; fresh branch-specific issuer |
| Auth issuer | `https://ep-soft-bird-b3lqgjne.neonauth.c-4.ap-southeast-1.aws.neon.tech/neondb/auth` |
| Vercel project / team | `prj_HlAi6mJDWDKLyisQo4ZmUlj6pS04` / `team_qvzlsFmfCsLkgItSypqHjw3z` |
| Accepted Preview deployment | `dpl_6FZPqESpfQ8azzByaWRzfBgLDruw`, READY, API target `staging`, no custom environment; actual `VERCEL_ENV=preview` |
| Immutable Preview origin | `https://aiso-remediation-uat-20261007-qc560v6uy-ynwaforevers-projects.vercel.app` |
| Retention deadline | 2026-10-14 13:10:59 UTC / 21:10:59 HKT |

Both the stable UAT alias and immutable Preview origin are trusted by this new Auth service. Google uses its shared development configuration. No production OAuth/SMTP secrets were copied; no magic-link email was sent. The same-session owner preflight verified the fresh project/branch/database/role, zero public application tables and the managed Auth user relation before baseline application. Existing production/legacy project and branch IDs remained deny-listed.

The consolidated baseline SHA-256 `d969357c1fefa3d657d73cc0b0ac5912c01dc029564820b0dfbd9060b39ddaf9` was applied to the fresh empty target. Existing `node scripts/migrate.ts --verify`, `--dry-run`, apply, second `--dry-run` and `--verify` all exited 0; exactly 21 pending files 039–059 were applied. The ledger has 58 entries. Before human capture, accounts/profiles/clients/scans/Auth users were all zero. No seed or forced baseline was used. The new `aeo_app` credential is private; owner credentials were excluded from Vercel runtime. Metadata readback verified 17 encrypted environment entries, all Preview-only, with no migration-owner, paid-provider, billing, email or scheduler credentials. Search Console and Pulse-attempt flags remain disabled for initial read/Auth UAT.

## Verification actually executed

Windows PowerShell / Node 24. Reports were read, assertions counted and command exits retained. Tests ran against source bytes subsequently committed as a6c2f2c. See `evidence/uat-execution/execution-receipt.json` for exact commands, UTC start/end times, source/deployment identity and original/report hashes. Redacted reports are included alongside it.

| Invocation | Discovered | Passed | Failed | Skipped | Exit |
|---|---:|---:|---:|---:|---:|
| Initial sandbox RED attempt, cache EPERM | 0 | 0 | 0 | 0 | 1 |
| Meaningful verifier RED before source fix | 41 | 39 | 2 | 0 | 1 |
| Focused verifier/cross-contract/runtime adapter GREEN, 3 files | 102 | 102 | 0 | 0 | 0 |
| `npm run test:unit`, 373 files | 5,348 | 5,348 | 0 | 0 | 0 |
| Fresh role catalog/SQL hash/DDL-denial checks | 293 | 293 | 0 | 0 | 0 |
| Human browser capture | 0 | 0 | 0 | 0 | 1 |

The first RED attempt executed no assertions and is an environment blocker, not a passing test or demonstrated regression. The actual RED exposed acceptance of standard Preview `staging` and rejection of a custom environment advertised with historical `null`; the minimal verifier fix followed those two failures.

Fresh role checks include 22 checked-in SQL hashes, the actual target identities, privileges for 62 tables, ten RPC checks, approval-column/Auth read-only privileges and four transactional DDL denials (`42501`). Twenty-four tables intentionally restrict blanket CRUD according to the existing expansion migrations. These checks do not replace the repository’s 22-test integration role suite or real account-filtered tenancy acceptance. They altered no grants.

Historical approved [CI run 37550438626](https://github.com/YNWAforever/aiso/actions/runs/37550438626) remains attributed to actual tested SHA `d0b12b656111c679bdb4be8fcc4105cfe7efa369`: unit 5,345; default DB 221; ten guarded exact-target suites 178, including feature-store-tenancy; browser fixtures 902; Worker own scripts/lockfile 8, plus typecheck/static/build. Those reports had zero required failures/skips. Its one-run role permission is consumed. No new privileged dispatch was made, no authorization flag was set, and those historical counts are not claimed as tests of a6c2f2c or as normal Auth evidence.

## Runtime and human boundaries

The operator transport POST returned HTTP 200/exit 0, and independent native metadata plus runtime identity match the new deployment and `aeo_app` target. Full readiness nevertheless reports `runtimeStatus=fail`, `configurationStatus=unknown`, `productionReady=false`. The protected deployment’s self-request to `/api/auth/get-session` has no automation bypass credential, so `auth.anonymous_session` is unavailable. A separate existing-authenticated Vercel CLI read of that route, without any AISO session, returned HTTP 200 with literal JSON `null`; this is anonymous-route evidence only. No remaining T22 application Auth fault reproduced, and its code/SDK were not amended. Optional AI, billing, email and scheduler capabilities remain unknown. No protection or guard was disabled to manufacture readiness.

`npm run e2e:auth:capture` opened the normal browser, with CI/fixture/dev-server modes unset and no old root cookies. It timed out after ten minutes at Vercel sign-in (exit 1), and no private storage-state file was created. Normal authenticated assertions executed: zero; blocked, not passed. Missing evidence is now human sign-in and real owner A/B/new-signup actor/tenant/client IDs, rather than missing deployment/DB/issuer setup. The six-case maintenance suite and a separate Desktop Chrome journey were not run without those inputs. Actual renewal, expiry, same-path activity and authorized session revocation are still unobserved.

Next authorized work is a fresh capture window when the human is ready: complete Vercel SSO, then Google sign-in in AISO; register actual isolated IDs; proceed with the existing read-only authenticated suite and separate Desktop UAT. Do not fabricate client IDs. Reviewer grants, Pro/Free transitions, source approval/revocation and session-revocation require concrete actor/content proposals and their separate authorization once real IDs exist.

## Failures and corrective actions retained

1. First fresh Neon project `super-unit-14336637` was deleted and independently verified absent after account refusal to modify its suspension interval (HTTP 412). Its initial endpoint parser produced an inconclusive `error:null`; that is not a pass. Official Neon material establishes stored timeout `0` as the default and Free suspension at five minutes. The retry’s actual compute was still active at 330 seconds, then observed idle at 411 seconds without intervening DB connections. No plan upgrade occurred. See [Neon scale to zero](https://neon.com/docs/guides/scale-to-zero-guide) and [Neon’s timeout convention](https://github.com/neondatabase/latency-benchmarks/blob/main/AGENTS.md).
2. The local initialization helper completed baseline/migrations and then incorrectly demanded full CRUD on every table, exiting 1. Read-only inspection established the checked-in append-only/admin privilege contract. No SQL grants were changed or migrations replayed. The continuation replaced only this new target’s `aeo_app` credential after the failed helper had not persisted it, then passed the 293 checks. The original failure remains in `initialization.json`.
3. Two CLI environment uploads failed with Invalid JSON; the readback after failure had zero keys. Correct request encoding succeeded, and final metadata verified the 17 Preview-only keys. No installed CLI source was patched.
4. The first new-project deployment omitted the API target and defaulted to `production`. This was an execution mistake: `dpl_9iQZekCYcqEcEzccTvsgzvhdeg3Q` was cancelled during build at 13:36:33 UTC, never accepted for UAT, with no Production-scoped runtime keys in the new project. Existing AISO production was unaffected. API `target=preview` was then rejected with HTTP 400 and allocated no deployment; explicit API `staging` produced the second and last allocated build, whose metadata/runtime verify Preview. The original mislabelled creation receipt is retained and superseded by its cancellation receipt.

## Preservation, rollout and rollback

All 24 T00–T23 rows and 36 AC01–AC36 rows now append `uat_setup_*`, `operator_compatibility_sha` and `current_unit_*` fields. All 1,948 prior tracked CSV cells and all 2,382 preflight CSV cells, IDs and order were retained. Existing F01–F22, UC01–UC22 and OP01–OP67 files and historical evidence are unchanged. New fields describe the current boundary without erasing the historical missing-target or CI records. Original delivery archives remain immutable. `preservation-validation.json` checks these statements.

At 13:56:42 UTC, existing production alias `aiso-kappa.vercel.app` still pointed to project `prj_f9sxRkT1gxcBSYgT7ELIwHWqUDDV`, deployment `dpl_3u2uYmVaoLGqGCTSWraVfUZXjzJ2` (previously verified main SHA `f49e1bd8951394cf88250b3ea88847d0038db491`). No existing production DB/role/Auth/Worker/schedule/alias was mutated. No provider payment/run, email, source approval/revocation, merge or production content cleanup occurred.

The reviewed production rollout proposal in `rollout-rollback-proposal.md` remains open. Selected new operator source is a6c2f2c; a later documentation-only delivery SHA must be recorded exactly and compared before a deployment proposal. The production migration ledger ending at 053 is prior read-only evidence, not a fresh SQL claim from this setup. Reconfirm application-bound DB/role, pending 054–059 hashes, current main/live deployment, backup/restore readiness and producer ownership before any new production proposal. Each consequential stage still needs an exact target/SHA/operation/rollback authorization. Existing source expansions must preserve scan/approval/answer history; rollback retains the schema and audit ledger, pauses affected producers, and restores the verified compatible application/Worker version. A valid model score cannot prove real consumer/search visibility. Actual daily/weekly scheduling windows remain required.

For the isolated setup, the registered rollback scope is only new Vercel project `prj_HlAi6mJDWDKLyisQo4ZmUlj6pS04` and its owned aliases/deployments, plus new Neon project `nameless-term-06793418` / endpoint `ep-soft-bird-b3lqgjne`. Stop on target drift, cross-tenant exposure or unexpected provider/email/job configuration. Export redacted evidence, then manually tear down those new resources by 2026-10-14 13:10:59 UTC. No automatic cleanup or monitor was scheduled; this is an outstanding retention obligation. Existing AISO production and historical audit resources are outside that cleanup scope.

Production acceptance remains open until actual authorized rollout, matching normal-session UAT and required real scheduling windows are evidenced.
