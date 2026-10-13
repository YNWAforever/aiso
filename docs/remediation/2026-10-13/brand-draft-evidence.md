# T32 — reviewable brand drafts
The existing bounded public homepage fetch and model service remain in place. No model/transport switch or new AI service.
Validated evidence retains only1–240-character exact NFC/whitespace source excerpts,recognized fields,max6 and no duplicates. Unsupported brand name/description stay blank; unsupported industry staysnull. Every AI draft requires human review. Matching text is never labeled semantic verification or a percentage.
Requested homepage URL remains server-owned and can follow validated redirects; fetchedAt is recorded before model latency. Model URLs/timestamps ignored. Very short pages return manual-only fields without a model call.
UI displays source,time and per-field excerpts/uncertain warning,lets users edit/supplement,then uses the existing form-only UseDetails action. Final brand creation remains separate. Request generations/context-tagged state fence late/context-changed/manual-takeover replies;context edits never auto-generate.

RED:5 actual service homepage cases failed;4 actual browser source/unknown-field cases failed. Missing helper suite is setup failure,not behavioral evidence.
GREEN:36/36 targeted unit/API/component;26/26 actual onboarding/assistant browser,0skip;EN/zh-HK,5 synthetic source types,redirect checks,manual recovery,sparse evidence,source/fetch time and stale context. Lint/typecheck passed after fixing React ref-render/effect-state issues without disabling rules.
UC63/67/68 local scopes passed. Real5sites×2 provider quality remains independently budget/access blockedT36;no paid calls/unsupported-claim quality certification/live claim.
Cleanup:fixture contexts/storage and owned serverclosed; no real tenant/Auth/provider records created.
Rollback:optional DTO fields can be ignored by earlier UI; revert validator/UI/provider schema together; retain samefetch safety limits and existing service.
