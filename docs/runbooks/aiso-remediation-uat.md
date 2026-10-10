# AISO candidate role and operation acceptance

This register preserves F01–F19, UC01–UC19 and OP01–OP63. Historical audit results remain historical; fixture results do not become live acceptance. The original archive is preserved locally with SHA-256 `c8479913f5ca74f476aa6b9d0e78f75cc9c69597a5c82eb0d8378069343218a5`.

The operation and user-case CSVs in `docs/aiso-remediation` bind new evidence to the candidate manifest. They contain the original IDs, controls and expectations, without publishing private AUDIT draft/source contents. Each live_result is pending or blocked until the matching role runs against the same SHA. Google OAuth was completed in the original audit; no new OAuth success is claimed.

| Role / fixture | Available evidence | Remaining real acceptance |
| --- | --- | --- |
| Free owner | Plan guards, honest empty states, API denial fixtures | Same-SHA logged-in UI |
| Pro owner | Synthetic Pro entitlement; Chinese/English question context; concurrent prompt cap; keyboard/mobile component evidence | Authorized isolated Pro session; no production plan upgrade |
| Independent reviewer | Disposable account member/grant composition and self-approval denial | Second person's normal login, submitted change-set, approval/request-changes, manual delivery acknowledgement |
| Account B | Guarded source/run DB reads and owner-backed exact-target tenancy fixtures | Separate human session and role revocation readback |
| New account | Persistent onboarding failure/retry/idempotency fixtures and disposable DB | New isolated authenticated identity and first-use flow |
| Maintenance data | 201 sources, complete200-row preview/retry,250 observations, multiweek and multi-page drafts,13/15 run | Authenticated route persistence and30-sample API performance |

Run the owner subset with `node scripts/ci/run-owner-remediation-suites.mjs`; it provisions only a registered disposable child, verifies/replays migrations, uses provider stubs and deletes the child in finally. It does not modify or read any application-role password. This subset excludes the app-role approval/delivery checks and is labelled L2 owner fixture evidence.

Required exact commands remain:

```text
npm run test:integration -- __tests__/integration/feature-store-tenancy.test.ts __tests__/integration/second-approver.test.ts
npm run e2e:authenticated -- tests/e2e/authenticated/aiso-maintenance.spec.ts
```

The default integration configuration excludes feature-store-tenancy, so the first command alone cannot prove that file ran; its dedicated configuration is executed by the owner subset. The authenticated command refuses when issuer/session files are missing. The new read-only spec requires AISO_UAT_ISOLATED=1 plus distinct approved A/B client IDs and explicitly tests360/390/1440px in en/zh-HK. Existing owner-review.spec.ts separately covers actual second-person decisions; never run it against the original private AUDIT work item.

No production source approval, agent-use permission, revocation, deletion, email, paid scan or Pulse job is part of these fixtures. The original live source remains unapproved and agent-disabled; the private AUDIT draft remains unsubmitted. Cleanup removes synthetic fixtures only from the disposable child. No destructive rollback of new immutable evidence tables is proposed.

T16 remains 受阻 for missing Pro, reviewer, account-B and fresh-account sessions and hydrated persistent role journeys. Actual isolated aeo_app login/permissions and ten exact configs were completed under this round's explicit authorization; see the current candidate manifest for its SHA, scope and cleanup. These limitations do not block independent code, fixtures or documentation.
