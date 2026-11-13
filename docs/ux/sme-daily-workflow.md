# SME daily workflow — approved next phase

Approved through plan review on 2026-11-13. Builds on the SME copilot redesign;
keep the five destinations and `FEATURE_SME_COPILOT_UI` rollback. Deliver in five
ordered PRs, each with complete gates and release evidence.

## Outcome

Today → confirm questions → start/check monitoring → read a saved answer → choose
one improvement → save/reopen a private draft and follow its task.

The owner should understand the next action without internal run/classifier/MCP
terminology. Unknown is not zero; a saved test response is not a customer search
result; saving a draft does not publish or verify a change.

## Delivery

1. **Truthful next steps and read-only diagnosis.** Verify real-brand monitoring
   configuration and retained state, without starting work. Preserve the concrete
   configure/start/review/repair/result link, query and fragment on Today; retain
   existing unrelated site-fix priority. Offer a monitoring-status link from empty
   observations. Paused/model/quota limitations must not send configured owners
   back to edit questions. Keep all known blockers visible.
2. **Guided monitoring.** One weekly status card and primary action, with saved
   answer/classification progress. Confirm start/retest/provider-calling repair
   before POST, showing workload and allowance. Keep important failure/spend
   notices visible; place technical metadata and secondary actions in details.
   Retain the existing question editor, active limit, intent keys and backoff
   polling. Preserve run/week and canonical/retest distinctions. Cancel reads on
   navigation and reconcile lost acknowledgements instead of minting new work.
3. **Reliable Studio action/save states.** Separate execution from conversation
   persistence. Bind result links to returned scan ID, original generation scan,
   or confirmed Hong Kong month. A 202 is pending, not completed. On known-thread
   save failure retry only the turn using its original request ID, never the paid
   action. Unknown thread creation stays unconfirmed and offers history reload;
   no blind replacement thread. No cross-device or exactly-once execution claim.
4. **Evidence to one improvement.** Plain next action, reason and private draft
   CTA. Reuse existing server ordering, eligibility, saved draft IDs, fingerprints
   and conflict checks. Distinguish generated text from evidence-eligible work.
   Preserve edit/version/review/approval/delivery behaviour; do not promote
   reserved agent recommendations into eligible work or infer source relations.
5. **Journey/accessibility/release evidence.** Extend actual component fixtures
   and browser journeys in both locales/themes at 320/390/768/1440px. Check
   keyboard/focus/44px controls, axe and terminology. Update status with distinct
   local, fixture and live evidence; verify deployed SHA and canonical URL.

## Contracts and failure cases

No new tables, migrations, public write APIs, MCP tools, paid providers, job queue,
pricing or automatic publishing. Reuse existing account-scoped APIs and actual
commercial entitlement gates; any necessary expansion needs a separate design.
UI changes stay flag-gated; shared safety logic is tested in both branches.
Existing URLs and their scopes remain valid. Each endpoint remains independently
authorized. Missing ownership stays 404; failed reads stay unavailable.

Test auth/plan failures, 429/503, no models/questions/context, paused and partial
runs, unclassified answers, duplicate clicks, lost replies, brand navigation,
stale fingerprints and thread/turn save failure. Cancel/open-page must not spend.
Run lint, typecheck, text audit, full unit, build and the complete PR CI gate.

## Rollout and limits

After each green candidate, merge through the existing Git/Vercel release path,
verify the deployment and perform authenticated read-only desktop/mobile checks.
No production monitoring/generation/brand writes are authorized by this plan;
request separate explicit approval naming the brand and workload for live write
acceptance. Do not enable paused collection or change models/schedules as part of
UI work. Rollback uses the existing feature flag and independently revertible PRs.

User acceptance: find the right monitoring next step, explain not-mentioned vs
unknown, and save/reopen a private draft without technical assistance. New MCP
writes, external integrations, reports rewrite, automated email and flag removal
are out of scope.
