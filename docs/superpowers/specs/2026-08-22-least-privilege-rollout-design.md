# Roll Production onto the Least-Privilege DB Role Design

**Goal:** Finish the least-privilege-role rollout migration `037` started. Vercel production is already cut over and verified (see below) — what's left is confirming the codebase makes no query `aeo_app` can't satisfy, and handing off a precise runbook for the two remaining, genuinely unverified connection-string consumers (n8n, MCP), without any agent handling a database password or a credential-store change itself.

**Context:** Migration `037_least_privilege_app_role.sql` (merged in [#47](https://github.com/YNWAforever/fimmick-aeo/pull/47)) created `aeo_app`: `BYPASSRLS` (deliberately — seven tables are RLS-enabled with zero policies, and a non-bypass role would return zero rows silently rather than erroring), `SELECT/INSERT/UPDATE/DELETE` on every `public` table plus matching default privileges for future ones, and `SELECT` only on `neon_auth."user"`. It cannot run DDL, create roles, or write anything in `neon_auth`. The role is created `NOLOGIN` on purpose — the migration's own header says a human sets the password out of band so it never enters git.

**What's already true, verified directly rather than assumed:** local dev's `.env.local` `DATABASE_URL` connects as `aeo_app` right now, successfully, against real production data (35 migrations, 8 accounts, 2 clients — `scripts/verify-db-connection.mjs`'s live output).

**Correction made mid-design, after reading further:** the design originally treated Vercel's production `DATABASE_URL` as unverified, alongside n8n and MCP. It isn't. [PR #47](https://github.com/YNWAforever/fimmick-aeo/pull/47)'s own description and test-plan checklist prove it, with specifics: *"Vercel `DATABASE_URL` cut over to `aeo_app`, redeployed, verified via a real scan against `fimmick-aeo-oitb.vercel.app` (writes through the new role, 200 response, scored 69/100)"*, plus a role-attribute check (`rolbypassrls=true`, `rolcreaterole=false`, `rolcanlogin=true`) and a project-wide error-log sweep for the cutover hour that found no new error class. `docs/runbooks/rotate-neon-credential.md` (updated in the same PR) already states this as settled fact. Vercel is done — it is not part of this design's remaining scope.

What genuinely remains unverified, because PR #47 never mentions either: **n8n's stored Postgres credential** and **the MCP Postgres server's shell-exported `DATABASE_URL`**. Neither was checked by pulling its actual value — a live secret should not pass through an agent's context to determine a fact the human can check locally in one command.

**One item PR #47 explicitly left undone, and this design surfaces but does not perform:** its own checklist has one unchecked box — *"Full manual verification still owed by a human with dashboard access: an authenticated dashboard load, a client report open (exercises `BYPASSRLS` against a default-deny table), a Stripe webhook replay, and a real signup (exercises the `neon_auth` grant)."* That's application-level QA, not a connection-string cutover, and it's already tracked in that PR — this design just makes sure it isn't lost, rather than duplicating it as new work.

Separately: a saved project memory claims dev "still connects as `neondb_owner`." That's verified false for dev, and the broader claim about Vercel is also wrong per the above — the memory gets corrected as part of this work.

---

## 1. Codebase audit (already performed — findings below, no code changes)

Swept `app/` and `lib/` for anything `aeo_app`'s grants don't cover:

- **No DDL anywhere outside `supabase/migrations/` and `scripts/migrate.ts`.** A repo-wide search for `CREATE|ALTER|DROP (TABLE|ROLE|INDEX|EXTENSION|POLICY)` and `GRANT|REVOKE` in application code turned up nothing — the only "grant"/"revoke" hits are `app/api/admin/clients/route.ts`'s plan-override feature, an unrelated business concept, not SQL.
- **Every `neon_auth` reference is a read, matching the grant exactly.** `app/api/webhooks/neon/route.ts` and `lib/alerts/neon-store.ts` are the only two files touching that schema, and both are `SELECT`/`JOIN` against `neon_auth."user"` — exactly what `037` grants. No write anywhere in application code touches `neon_auth`.
- **`app/api/scan/route.ts`'s `process.env.DATABASE_URL` reference is a presence check, not a second connection** — it doesn't open its own pool with different needs.

**Conclusion, and it's evidence-backed, not inferred: the app's actual query set is fully compatible with `aeo_app`'s restricted grants.** No source change is required for the cutover. Live dev traffic against `aeo_app` already proves this in practice, not just in theory.

## 2. The runbook

New file: `docs/runbooks/roll-out-least-privilege-role.md`, following the shape of the existing `docs/runbooks/rotate-neon-credential.md` (both are "a human executes a sequence this document makes precise and safe" documents), scoped to exactly the two remaining touch points:

- **Baseline**, matching the existing pattern: what `scripts/verify-db-connection.mjs` should report at n8n and MCP before and after.
- **n8n's stored Postgres credential**: `n8n/configure-credentials.sh` already assumes `DATABASE_URL` is `aeo_app` (confirmed by reading its comments) — the runbook says when and how to re-run it, and how to check the credential it produced without printing it.
- **MCP Postgres server's shell-exported `DATABASE_URL`**: where that's set (outside this repo — a shell profile or launch config) and how to verify/update it.
- **A pointer, not a duplicate, to PR #47's outstanding manual-QA checklist item** — named above, so a reader of this runbook sees it's tracked rather than assuming this rollout is now fully done.
- **Rollback**: `neondb_owner`'s connection string is untouched by any of this and keeps working — if a touch point breaks after cutover, reverting that one variable is the fix. n8n and MCP are independent of each other, so no coordinated rollback is needed.
- **Verification**: run `scripts/verify-db-connection.mjs` against each updated target and confirm `role: aeo_app` with matching schema counts to the pre-cutover baseline.

No new tooling is written — `scripts/verify-db-connection.mjs` already reports exactly what's needed (`role`, `db`, and the three schema counts), and it already exists specifically so this kind of check never needs the DSN printed.

## 3. Correct the stale memory

The saved project memory claims dev, n8n, and MCP "still connect as `neondb_owner`." That's verified false for dev, and per PR #47 it's also false for Vercel (which the memory didn't even mention as done). The memory gets rewritten to state what's actually confirmed — dev and Vercel: done and verified; n8n and MCP: still unconfirmed, not "still on owner" — rather than repeating an assumption as settled fact.

---

## What this design deliberately does not do

- **Does not touch Vercel at all.** It's already cut over and verified per PR #47 — re-doing or re-checking it here would be redundant work against a settled fact, not caution.
- **Does not generate, view, or enter any password.** The `037` migration's own header is explicit that this is a human-only step, and it already happened for local dev and Vercel — nothing in this plan asks an agent to touch a credential.
- **Does not touch n8n or the MCP server's configuration directly.** That's an account/credential-adjacent change; the runbook documents exactly how to do it, and the human executes it.
- **Does not change any application code.** The audit's conclusion is that none is needed; if it had found something, that would be a different, larger plan.
- **Does not perform PR #47's outstanding manual-QA checklist item.** That's real, already-tracked work belonging to that PR, not this design — this design only makes sure it's visible, not lost.
- **Does not attempt to determine n8n/MCP's current state by pulling live secrets into this session.** The runbook tells the human how to check locally, in a way that never surfaces the DSN in a place an agent (or a ticket, or a terminal scrollback) could read it.
