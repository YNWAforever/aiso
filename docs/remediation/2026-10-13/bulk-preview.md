# T24 — F65 trustworthy bulk previews
Original mixed CSV:3 rows=1 applicable+1 duplicate+1 invalid; projected active count9 from original8. Duplicates/invalid rows never enter validRows; rejected updates retain original questions; valid simultaneous swaps remain supported. Any row/batch errors still block the entire apply.
UI explains each row in EN/zh-HK with legalHK/language/category codes and a synthetic CSV download. Projection is explicitly unapplied only before a save; in-flight/unknown says it may already be applied.409 retains CSV and requires a fresh preview. Unknown freezes edits/new preview; manual confirmation uses the original intent and scoped receipt lookup before any write. Pending receipt is503, never null200. No automatic retry,new SQL shape,schema or Auth change.

Evidence:
- Pure preview RED3/6 then6/6 GREEN; store/API pendingRED2/17.
- Final targeted unit/category36/36. Existing category row/label assertions retained and scoped away from separate CSV guidance; positive assertions now cannot be masked by the bulk list.
- Actual component browser20/20,0skip:12 new cases+8 original audit-loop cases. Includes original mixed/invalid-market CSV,corrected apply,409,lost-response/pending,one intent,acknowledgement unlock.
- Actual local PostgreSQL19/19,0skip,app-role binding and scoped SQL:atomic refusal,version/CAS,idempotency,foreign-account refusal,immutable frozen run. Earlier targetedSQL1pass/16filtered-skipped is retained separately,not counted as full acceptance.
- Build passed before final wording update; final lint/typecheck passed. Final same-candidate build/CI belongsT36.

Environment:task-owned localhost55439 fixture,not hosted Neon/Auth;68 local migrations. Only test UUID data created/cleaned by passing afterEach hooks. Existing container retained,no reset/role/migration invoked. No external provider/Auth/production writes.
New fixture initially lackedUTF8:historical UI RED includesEN behavioral failures andZH encoding blockers,documented separately. Final UTF8 execution validates both locales. No timeout/guard/assertion reduction.
UC41/42/43/61 local portions passed;UC58 actual Auth/hosted portions remain blocked. No verified_live.
Rollback:revert UI+preview+pending-error changes together,retaining existing ledger/atomic apply and historicalRED.
