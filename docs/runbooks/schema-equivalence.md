# Schema-equivalence rehearsal

Moved from the README in UX Phase 8. Local tooling; live approval is separate.

Slice C provides a strict request-bound rehearsal and canonical cleanup-bound evidence.
The Node 24 command, only after separate approval of exact live inputs, is:

```text
node scripts/schema-equivalence.mjs --request ABSOLUTE_REQUEST_JSON_PATH --output-dir ABSOLUTE_OUTPUT_DIRECTORY
```

Both flags are required. The request pins the project, sterile parent, database/role,
protected IDs/hosts, sterility reference, clean source SHA and actual manifest hash.
Unknown/duplicate options and JSON fields fail closed. Put operator files outside the
checkout or in an explicitly ignored directory. Inject NEON_API_KEY only from a
separately approved source; no dotenv or database URL fallback is used.

Cleanup requires exact active-child absence readback after recoverable deletion;
TTL never confirms deletion. Failed cleanup or a partial artifact write returns exit 1.
Artifacts always retain enforced:false and productionReady:false; local validation
cannot establish provenance and reusable remains false, even for live-labeled input.

Final source d8347fa passed 436 selected synthetic tests across 10 files in two runs
and changed-file lint. Independent whole-slice source review approved the final repair;
local tooling is complete. Earlier typegen/TypeScript and full scoped lint passed at
b866f14; the final repair changed only MJS/tests. No live schema equivalence has been proved. See the [schema handoff](../superpowers/plans/2026-09-08-schema-equivalence-handoff.md)
for the exact request, limits, dated verification, synthetic example and blocked live
proposal. A later docs commit changes HEAD and therefore requires a new manifest hash.
