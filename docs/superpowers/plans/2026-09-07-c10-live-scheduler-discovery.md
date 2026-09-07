# C10 live scheduler discovery and activation boundary

Observed: 2026-09-07. Branch codex/c10-readiness-audit; prior source audit619b82a; application source remainsa7cae4fd. User supplied a temporary Cloudflare token for autonomous discovery. It was passed through no-echo standard input to a local read-only helper, held in process memory, and never saved to a file/configuration or printed. Both inspection processes exited. The credential itself is intentionally absent from this document. Its advertised one-day lifetime is user-reported, not independently verified expiry metadata.

## Verified external metadata

- Cloudflare account ID: e387dfbeded3deb5b8f0023a78a660b5. Account listing returned exactly one account (page1/1). Workers listing returned12 scripts; no Fimmick/AISO Worker name or obvious alternate was present. Unrelated Worker details were not inspected.
- Expected Worker: fimmick-aeo-cron-worker. GET schedules, deployments and settings all returned HTTP404 / Cloudflare error10007. Thus this configured Worker is absent in the accessible account; this does not rule out another account, unrelated alias or non-Cloudflare producer.
- Configured APP_BASE_URL: https://aeo.fimmick.com. System CNAME/A lookup reported name nonexistent. Independent https://cloudflare-dns.com/dns-query?name=aeo.fimmick.com&type=A returned DNS Status3, Answer null and fimmick.com SOA. At observation time this hostname is not a usable scheduler destination.
- Vercel team: team_qvzlsFmfCsLkgItSypqHjw3z (ynwaforevers-projects).
- AISO project: prj_f9sxRkT1gxcBSYgT7ELIwHWqUDDV, repository YNWAforever/aiso. Returned latest deployment dpl_pGejLtrozYBNvt5eVUqKRXyx8JAp is READY, target null (preview), SHA b48b119165fe4d35402a6540d19b69123df95b5e, branch codex/c8c-g-workspace. Listed aliases include aiso-kappa.vercel.app and project/branch aliases; no aeo.fimmick.com alias was returned. This is not proof the local C9f implementation is deployed.
- Legacy project: prj_I7dkgUiQGHJfYqKwiZCY5mHHjOmP, fimmick-aeo-oitb, repository YNWAforever/fimmick-aeo. Returned latest deployment dpl_H4i6SbFMN6kCqsTCud9TBYCJEQBi is READY and target production, SHA f66a8d312fdba1f7b00cd21f187a25838bb81233 on main. Returned stable alias fimmick-aeo-oitb.vercel.app is a candidate destination consistent with the recorded legacy-production topology. The production role is verified from deployment metadata; database/provider bindings and intended scheduler activation are not thereby approved.

Cloudflare reads used the documented Workers list/schedules/deployments/settings GET APIs: https://developers.cloudflare.com/api/resources/workers/subresources/scripts/. Vercel connector project/deployment responses do not expose current cron definitions; absence of a cron field is not proof of no schedules. No cron route was invoked, no Worker content or secret value downloaded, and no live execution log/customer payload inspected. No n8n state was discovered.

## Prepared proposal, NOT EXECUTED

Exact candidate Cloudflare target: account e387dfbeded3deb5b8f0023a78a660b5 / Worker fimmick-aeo-cron-worker. Retain the existing source's three schedule mappings; do not choose the AISO preview as production. If legacy production is confirmed ready for scheduled work, the necessary origin correction would be:

```diff
--- cloudflare/cron-worker/wrangler.jsonc
+++ cloudflare/cron-worker/wrangler.jsonc
@@
-    "APP_BASE_URL": "https://aeo.fimmick.com"
+    "APP_BASE_URL": "https://fimmick-aeo-oitb.vercel.app"
```

This is a draft in this document, not an applied config edit or activation authorization. Before deployment it requires:

1. Exact legacy production database/role and provider mode verification plus named operational owner. Do not infer these from a domain, READY state or token permissions. Preserve current production topology; no C11 cutover.
2. Read-only Vercel Cron and legacy n8n ownership evidence covering Pulse, alerts and trial emails; establish one producer per job. The present APIs did not supply that evidence.
3. Worker CRON_SECRET must match the intended Vercel target. Source: that project's production CRON_SECRET, not the temporary Cloudflare account token. This audit did not inspect its value or verify its presence. Transfer through the approved secret-management path only; do not put either credential in git, report text or shell arguments.
4. Correct the blanket idempotency wording before release and explicitly accept or redesign the trial-email send-then-persist duplicate risk. Local existing30tests passed in the preceding audit; mocked throws do not prove platform retries or exactly-once side effects.
5. Review an activation diff and validate against a separately authorized isolated endpoint with fake email/scan ports. Schedule activation can cause real email, paid scans and data writes; it is outside the original local/read-only authority even though the account credential works.

Expected activation verification: inspect deployed source/version, APP_BASE_URL non-secret metadata, secret binding name, exact trigger set and safe execution/ledger completion evidence. HTTP2xx alone does not prove all asynchronous Pulse work completed. Abort on wrong origin/schema/provider mode, unresolved duplicate producer, missing secret, mixed deployment version or failed isolated proof.

Rollback proposal: disable only this new Worker's cron triggers first and verify that state. Do not automatically restore Vercel crons or enable n8n, which could duplicate producers. Preserve deployment identifiers and downstream audit records. Already sent mail or provider requests cannot be undone; pending/background work needs explicit reconciliation. No rollback mutation is authorized by this document.

## Current disposition

Read-only account/project discovery is complete. No additional account/project IDs are needed from the user for these verified targets. Activation is NOT READY because ownership, downstream environment/secret binding and isolated side-effect validation are unresolved. No deployment, trigger/secret/DNS mutation, paid scan, email, database action, push or merge occurred. No application files changed, so no new application test run is claimed in this metadata-only continuation. C9f remains complete at its preserved branch; C10/C11 external proof remains open.

Browser fallback for Vercel cron ownership was attempted at https://vercel.com/dashboard using the in-app browser. It failed before page creation with the Windows sandbox helper error apply deny-read ACLs. No dashboard state was read and no browser action occurred. The browser tool exposes no per-call escalation override; no ACL or permission configuration was changed. Vercel/n8n schedule ownership therefore remains unverified rather than assumed absent.
