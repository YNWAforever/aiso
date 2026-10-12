# T35 / UC73-74

Four diagnostic events: onboarding_started, brand_draft_requested, brand_draft_reviewed, onboarding_manual_selected. Client/server allowlists agree. New events contain only name, attemptId and locale; arbitrary runtime extras are removed before transport and rejected by server. Existing scan/auth diagnostics retain their approved fields. Async failures are swallowed with no retry. Browser event means an attempt or explicit review action, never brand creation or provider success.

Local RED25executed:20pass/5fail (4new names +client extras). Final33/33 unit/API/component and32/32 real onboarding browser cases,0skip;lint/typecheck0. Browser deliberately aborts diagnostics transport and completes editable draft review;4events share oneattempt andcontain no URL, brand, prompt or rawcontent.

Measurement contract:
- Start/request/manual/review denominators: unique attemptId+locale in accepted redacted diagnostics, with transport loss reported; reload events are not new successful brands.
- Brand denominator/time: account-scoped clients and onboarding_progress facts; ready/failed/pending retained independently. updated_at is the most recent transition, not an invented first-ready timestamp.
- First recorded result: existing readActivation(account_id).firstResults.resultAt and canonical persisted evidence. Recorded row time is a proxy, not proof of the first human-readable screen time. Read errors are unknown; no zero fallback.
- No second success-event table or new schema. Actual setup active/wait/login durations require timed observation; current diagnostics alone cannot establish them.

UC74 human usability remains not-tested:0/5 recruited,0/5 observed. Preallocated slots1–5 have no participant/time/result. Record active seconds, AI wait seconds, login seconds, help requested and completion once recruited; target4/5 unaided andmedian<=3min is unmeasured. No percentage/median inferred from fixtures.

Rollback: revert newdiagnostics/clienthooks without touching durable milestones or product data.
