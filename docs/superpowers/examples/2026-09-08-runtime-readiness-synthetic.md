# SYNTHETIC EXAMPLE - NOT LIVE EVIDENCE

Generated only from __tests__/fixtures/runtime-candidate.json using renderReport. No provider, candidate or database was contacted. The JSON wrapper is deliberately rejected by validateReport and the runner. Passes below are fixture values, not observations. Source: 27d2a9a0d9cfb95a6211148020c9046f09239500.

Policy relation index 0: public.clients, SELECT. Keep the JSON policy beside the report to interpret relation indexes.

# AISO runtime readiness

REPORT ONLY / NOT ENFORCED
Production readiness: unverified
Configuration: pass
Runtime: pass
Nonce: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
Policy hash: 78d4ece3f26f22294c212af21f16c268caad4ae4b7262a8252711124c6629ae0
Started: 2026-09-08T01:00:00.000Z
Completed: 2026-09-08T01:00:01.000Z

## Expected candidate
- commitSha: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
- deploymentId: dpl_test
- environment: preview
- projectId: prj_test
- teamId: team_test

## Configured team (verified against control plane)
- teamId: team_test

## Observed candidate
- commitSha: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
- deploymentId: dpl_test
- environment: preview
- projectId: prj_test
- teamId: unavailable

## Observed database
- branch: br-test
- database: neondb
- project: project-test
- role: aeo_app

## Checks
- config.DATABASE_URL: pass (valid)
- config.NEON_AUTH_BASE_URL: pass (valid)
- config.NEON_AUTH_COOKIE_SECRET: pass (valid)
- config.PUBLIC_SCAN_RATE_LIMIT_SECRET: pass (valid)
- config.NEXT_PUBLIC_APP_URL: pass (valid)
- config.VERCEL: pass (valid)
- config.REPORT_SHARE_SECRET: pass (valid)
- config.OPENROUTER_API_KEY: pass (valid)
- config.STRIPE_SECRET_KEY: pass (valid)
- config.STRIPE_WEBHOOK_SECRET: pass (valid)
- config.STRIPE_PRICE_BASIC: pass (valid)
- config.STRIPE_PRICE_PRO: pass (valid)
- config.STRIPE_PRICE_ENTERPRISE: pass (valid)
- config.RESEND_API_KEY: pass (valid)
- config.RESEND_FROM_EMAIL: pass (valid)
- config.RESEND_TRIAL_FROM_EMAIL: pass (valid)
- config.CRON_SECRET: pass (valid)
- binding.EXPECTED_NEON_PROJECT_ID: pass (valid)
- binding.EXPECTED_NEON_BRANCH_ID: pass (valid)
- binding.EXPECTED_DB_ROLE: pass (valid)
- binding.EXPECTED_DB_NAME: pass (valid)
- binding.connection_role: pass (valid)
- binding.connection_database: pass (valid)
- binding.forbidden_target: pass (valid)
- capability.claims: pass (required)
- capability.ai: pass (required)
- capability.billing: pass (required)
- capability.email: pass (required)
- capability.scheduler: pass (required)
- candidate.identity: pass (matched)
- configuration.core: pass (valid)
- database.identity: pass (matched)
- database.read_only: pass (read_only)
- database.relation:0:SELECT: pass (privilege_present)
- auth.jwks: pass (available)
- auth.anonymous_session: pass (anonymous)
