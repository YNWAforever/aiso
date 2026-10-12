# T25 — monitoring pause investigation

Observed 2026-10-12T17:57:07.579Z (2026-10-13 Hong Kong). Read-only evidence; monitoring activation not authorized.

| Finding | Confirmed evidence | Unknown or limit | Next step |
|---|---|---|---|
| Source gate | readUserPulseOptions enabled=isFeatureEnabled('pulse_attempts'); only exact FEATURE_PULSE_ATTEMPTS=1 enables it | GET enabled alone proves no provider or Worker chain | Keep gate paused; T31 explain reasons |
| Project configuration | Production FEATURE_PULSE_ATTEMPTS key absent; source default off | Immutable runtime owned prepare GET not freshly observed; audit UI previously disabled | Do not call forbidden production POST; hosted owned GET requires proper session |
| Scheduled producer | Worker a3f46e65-aa0f-4d62-9a7c-a007e1abde64, only 47 7 * * 1; no dailyPulse17 4 trigger | n8n sensitive metadata exists; workflows/scoped credential unknown | inventory/capped canary/activation packet before enable |
| DB target | weathered-wave-50814522/br-square-mountain-az6f82vi/neondb; aeo_app READ ONLY verified; ledger69/eight checksums match | schema presence is not journey readiness | do not rerun063–070 |
| Stored evidence | raw40/canonical6/run0/attempt0 global counts | legacy does not prove a current canonical run; client context/quota not freshly measured | existing raw classification/review separate from recollection |
| Business prerequisites | source validates plan/model variants, active questions/context, canonical identity, quota/reservation | Audit8x5/1500 is historical; current per-client entitlement/model/quota unknown without authorised scoped read | T31 typed seven reasons, edit questions/view existing/wait/start |
| Spend/schedule | API costEstimateUsd=null,nextDueAt=null,scheduleState=unknown | no real canary; limited key absent | Never show free/zero/already scheduled |

Cause supported by source and control plane: intentional pause gates are still in effect. No current evidence that migration is missing. This is an investigation result, not a repair of the production monitoring workflow or UC35 pass.

User can review/edit saved starting questions and legacy observations while monitoring is paused. Operator unlock requires producer inventory, runtime/model evidence, dedicated hard-cap canary and separate activation authority. No config toggles, cron invocation, provider request or migration were performed.
