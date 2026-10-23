# Manual runtime readiness

Moved from the README in UX Phase 8. Local implementation; live approval is separate.

Slice B adds a protected, read-only runtime probe and explicit candidate runner.
Configuration and runtime results always retain `enforced: false` and
`productionReady: false`; exit 0 means only that the selected checks passed.
Whole-branch independent review approved the local implementation; no live candidate has been verified.

After separately approving a concrete candidate and credential sources, use Node 24:

```text
node scripts/readiness/check-candidate.mjs --team TEAM_ID --project PROJECT_ID --deployment DEPLOYMENT_ID --sha FULL_LOWERCASE_SHA --environment preview --policy POLICY_JSON_PATH --output-dir OUTPUT_DIRECTORY
```

All seven options are mandatory. Team/project/deployment must be immutable IDs
(`team_`, `prj_`, `dpl_`); SHA is exactly 40 lowercase hex characters. Environment
is explicitly `preview` or `production`, with no default. Unknown/duplicate options,
aliases and URL targets fail closed. This placeholder command is not authorization.
The runner does not load dotenv files and accepts no credential CLI options.

Inject `VERCEL_TOKEN` from the approved operator's Vercel metadata credential,
`READINESS_PROBE_SECRET` from a separately provisioned dedicated server secret,
and, when protection requires it, `VERCEL_AUTOMATION_BYPASS_SECRET` from that
candidate project's Deployment Protection automation configuration. The first
reaches only the Vercel control plane; the second authenticates the readiness
endpoint; the third crosses outer deployment protection. They are separate credentials.

Artifacts are exclusive `readiness-{nonce}.json` / `.md` writes in the explicit
output directory. Existing files are never replaced. A failed Markdown write can
leave validated JSON alone and returns exit 1; there is no atomic pair guarantee.
Honest failed/unknown reports are retained with exit 1. Invalid reports or failed
metadata checks are rejected before artifact writes.

See the [runtime handoff](../superpowers/plans/2026-09-08-runtime-readiness-handoff.md) for policy format,
limits, exact local evidence, and the blocked live-action proposal.
The [synthetic sample](../superpowers/examples/2026-09-08-runtime-readiness-synthetic.md)
is fixture-only; its JSON wrapper is intentionally rejected by the runner.
