# T36 review corrections / UC62, UC64, UC65-66

Behavior-first actual component RED found storage-denied reload dropping the original setup intent and retest ignoring known answer quota (4/4 failures). A further configured-but-paused case found no useful question-review link (2/2 failures). These are additional combinations within the existing cases, not new audit IDs.

The existing wizard now supplements sessionStorage with a bounded private tab-history cache for up to eight account/scan scopes. Revisions choose the newest successful write, tombstones prevent stale resurrection, and Next router state is preserved. It accepts legacy raw drafts. Cache data is untrusted; existing server ownership and request hashes remain authoritative. If neither cache can retain a new setup request, the wizard blocks its POST and offers the existing saved-brand page. It adds no Auth, SQL, remote draft store or success ledger.

Retest uses the frozen original run workload for quota checks; mutable current questions do not raise its required units. Server reservations remain intact. Paused configured users can review questions; unavailable reads offer a read-only GET refresh and block mutations until recovery. No automatic mutation retry or operational flag change.

Targeted acceptance:40/40 unit/API/component contracts,12/12 actual Chromium cases,0skip; lint/typecheck exit0. Includes A/B synthetic prop switching, partial-cache writes, legacy drafts and read-only503 recovery. Actual Auth remains blocked.

Earlier all-project baseline atfc5b3119:1332pass,6skip,0fail,0flaky. Every skip was the obsolete Supabase credential precondition inemail-gate. Replaced it with a mandatory isolated E2E fixture assertion, retaining all original behaviors; target4/4pass0skip. This does not prove a real magic-link/login or send email. Final same-candidate CI is separate.

Rollback: compatible client/UI revert, preserve all server brands/intents/runs and expanded schema. Private browser caches are optional UI state, not authorization or evidence of creation.
