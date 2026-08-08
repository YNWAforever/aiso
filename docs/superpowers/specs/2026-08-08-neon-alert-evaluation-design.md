# Neon-native alert evaluation

Date: 2026-08-08  
Status: design approved; implementation pending written-spec review

## Context

The alert-evaluation domain logic is already isolated in `lib/alerts/evaluate.ts`, but the cron adapter currently uses Supabase PostgREST, Supabase service-role authentication lookups, and a Supabase RPC. This repository's active application database and authentication source are Neon and Neon Auth. Migration 022 already points `profiles.id` at `neon_auth.user(id)`.

Migrations 033 and 034 have not been applied. They currently mix useful PostgreSQL indexes with a Supabase-specific `get_alert_weekly_snapshot` function and Supabase role grants. The correction must make the alert path Neon-native without attempting a live migration or changing unrelated legacy Supabase modules.

## Goals

- Make the alert cron route use the existing Neon `db()` connection and the Neon Auth database tables.
- Keep the evaluator provider-agnostic and preserve its existing alert semantics and `{ processed, fired }` response.
- Preserve bounded reads, deterministic snapshot selection, and notification idempotency.
- Replace the unapplied 033/034 SQL with ordinary PostgreSQL index migrations that work on Neon.
- Add focused tests that exercise the adapter contract and migration safety before any database branch verification.

## Non-goals

- Removing `@supabase/supabase-js`, Supabase helpers, or other legacy Supabase flows outside alert evaluation.
- Changing alert thresholds, action ordering, email template behavior, dashboard URLs, or the evaluator's fail-soft policy.
- Applying migrations to production or invoking the cron against live data.
- Migrating unrelated auth, billing, scan, or dashboard modules.

## Architecture

### Domain boundary

`lib/alerts/evaluate.ts` remains the domain layer. Its existing `AlertEvaluationPorts` contract remains the seam for storage and delivery. The evaluator does not import Neon, Supabase, SQL, or authentication libraries.

The contract continues to provide:

```ts
type AlertEvaluationPorts = {
  loadSnapshot(): Promise<AlertSnapshot>
  upsertNotification(notification: AlertNotificationInput): Promise<void>
  sendAlertEmail(email: AlertEmailInput): Promise<void>
}
```

The exact existing domain types remain authoritative; the snippet above documents the boundary rather than introducing duplicate public types.

### Neon adapter

Add a focused server-only adapter in `lib/alerts/neon-store.ts`. It accepts the Neon query function from `lib/db.ts` and implements `AlertEvaluationPorts`.

The adapter is responsible for:

1. Loading enabled alert configurations in keyset pages of 1,000 rows using `id > lastId`, `ORDER BY id ASC`, and `LIMIT 1000`. Each page joins the related client row and only retains configurations with an existing client.
2. Loading each configured client's latest two distinct aggregate weeks from `pulse_weekly_summary`, restricted to `platform IS NULL`. The query must select one deterministic row per `(client_id, scan_week)` using `created_at DESC NULLS LAST, id DESC`, then rank weeks by `scan_week DESC` and retain two rows per client. Nullable `sov_score` values must be passed through unchanged.
3. Loading the first deterministic profile for each configured account and joining `profiles.id` to `neon_auth.user.id` to obtain the email. The result must be normalized to the evaluator's `emailsByAccount` shape. A missing profile or missing email means that only email delivery is skipped.
4. Building dashboard URLs from the existing `NEXT_PUBLIC_APP_URL` convention without moving URL construction into the evaluator.
5. Inserting notifications with a PostgreSQL `ON CONFLICT (client_id, type, scan_week) DO NOTHING` clause. A duplicate notification is a successful no-op.

The adapter may issue independent snapshot and profile reads concurrently, but a failed snapshot read is a hard evaluation failure. It must not call a Supabase client, Supabase RPC, Supabase Auth Admin API, or a database-side alert function.

### Route composition

`app/api/cron/evaluate-alerts/route.ts` becomes a thin composition root:

- Preserve the existing cron-secret authentication and unauthorized response.
- Instantiate the existing Neon `db()` function.
- Compose the Neon adapter with the existing Resend delivery function.
- Call `runAlertEvaluation` once and return the existing response shape.
- Preserve the existing error logging and 500 behavior.

The route must not contain query pagination, snapshot ranking, profile lookup, or provider-specific data normalization. `DATABASE_URL` remains the only database connection required by this path; no Supabase service-role environment variable is introduced.

### Evaluation and delivery behavior

The evaluator first computes all actions from the loaded snapshot. For each fired action it then attempts notification insertion and email delivery in the existing sequential order. Notification and Resend failures remain fail-soft per action so one client's delivery problem does not prevent other actions from being evaluated. Missing email skips only the email attempt. Snapshot loading and other required read failures remain hard failures.

## Migration design

Because 033 and 034 are unapplied, rewrite them in place rather than adding a third corrective migration.

### 033: alert evaluation hardening

- Drop the old `public.notifications_dedup_idx` if present.
- Create the non-partial unique index `notifications_dedup_idx` on `public.notifications (client_id, type, scan_week)`.
- Create the initial `pulse_weekly_summary_alert_snapshot_idx` on `(client_id, scan_week DESC, id DESC)` with `WHERE platform IS NULL`.
- Remove the `get_alert_weekly_snapshot` function, `SECURITY DEFINER`, `SET search_path`, and all `PUBLIC`, `anon`, `authenticated`, and `service_role` grants/revokes.

### 034: snapshot refinement

- Drop `public.pulse_weekly_summary_alert_snapshot_idx` if present.
- Recreate it on `(client_id, scan_week DESC, created_at DESC NULLS LAST, id DESC)` with `WHERE platform IS NULL`.
- Do not create or alter any function, role grant, or Supabase-specific object.

The adapter's direct SQL is the single implementation of the bounded snapshot query. The indexes support that query but do not encode application behavior in a privileged function.

## Error and security boundaries

- Cron access remains gated by the existing secret; authentication behavior is unchanged.
- Database access remains server-only through the existing Neon query helper.
- `neon_auth.user.email` is read only by the server-side database connection and is never exposed through a public data API.
- No new public database grants are required for alert evaluation.
- No production database mutation, branch completion, email send, or cron invocation is part of local implementation or tests.

## Testing strategy

Use test-driven development for the adapter and route correction.

### Unit and route tests

Replace the Supabase-specific alert route fixtures with Neon adapter tests that prove:

- Config rows page at 1,000 and continue with a stable keyset cursor.
- Joined client rows normalize to `AlertConfigWithClient`.
- The snapshot query returns only two distinct weeks per client and resolves duplicate rows with the specified `created_at`/`id` ordering.
- Nullable scores remain nullable.
- Neon Auth emails are mapped from `neon_auth.user` and missing emails skip only delivery.
- Duplicate notification inserts use the conflict target and are treated as no-ops.
- Snapshot failures prevent evaluation; notification and email failures remain isolated per action.
- The route preserves cron authentication, response counts, and error handling.

Keep the existing evaluator tests unchanged except where the corrected adapter contract requires fixture naming updates. Add static migration assertions proving that 033/034 contain the required indexes and contain none of the removed Supabase RPC or role-grant statements.

### Verification commands

Run the focused alert tests first, then the full Vitest suite, TypeScript checking, lint, build, and a final diff/status review. Report each result separately. Missing external Neon tooling or credentials is an environment gate, not evidence of a source regression.

## Neon branch release gate

After implementation and local verification, use a dedicated non-production Neon branch named `preview-alert-evaluation` in project `AEOGEO` (`red-firefly-93523049`). Do not reuse the existing `preview-pro-client-reports` branch.

On the dedicated branch only:

1. Prepare or create the branch for migration verification.
2. Apply 033 and then 034 through the Neon migration workflow.
3. Verify the indexes, absence of the alert RPC, latest-two-distinct-week behavior, notification deduplication, and Neon Auth email join with read-only SQL.
4. Stop before production migration or cron invocation and request a separate explicit approval for any production action.

If the branch cannot be created or the Neon connection is unavailable, preserve the code and report the exact external gate without substituting Supabase credentials or mutating another branch.

## Risks and mitigations

- Legacy Supabase modules may still be present. Scope checks must be limited to the alert route and adapter so those modules remain unchanged.
- Migration 022 must already be present for the `profiles` to `neon_auth.user` relationship. Branch verification must confirm the prerequisite before applying 033/034.
- Neon Auth schema details can differ between local fixtures and the branch. The branch read-only verification must validate the actual `neon_auth.user` columns before claiming the join works.
- Direct SQL can become expensive if the alert population grows. The 1,000-row keyset pagination and covering snapshot index keep reads bounded and make the query plan inspectable.
