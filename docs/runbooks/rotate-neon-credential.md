# Runbook: rotate the Neon `neondb_owner` password

**When to run this:** the connection string has been disclosed — pasted into a
transcript, a log, a ticket, a screenshot — or on a scheduled rotation.

**Who runs it:** a human with Neon console access. An agent must not perform any
step that reads or types the password.

**Precondition — read this first:** this runbook assumes every consumer that
doesn't need DDL has already moved to `aeo_app` (migration `037`). If you're not
sure that's true, stop and run the consumer-migration steps in
`docs/superpowers/plans/2026-08-16-rotate-neon-credential-least-privilege.md`
(Task 3) first. Rotating before that reproduces the old, much larger blast
radius — every consumer still on the old password breaks the moment it's reset.

**Blast radius, once the precondition holds:** exactly one place —
`MIGRATE_DATABASE_URL` in `.env.local`, used only by `npm run migrate`. Nothing
else references `neondb_owner`. In particular:

- **Vercel is not touched.** Production connects as `aeo_app`, not
  `neondb_owner`, and always has since `037`'s cutover.
- **No deployment needs redeploying**, and no per-deployment verification is
  needed as part of this runbook.
- **Crons are not affected.** `/api/cron/pulse` and `/api/cron/evaluate-alerts`
  run inside the same deployed app, as `aeo_app`.

## Procedure

1. **Reset the password** in the Neon console: project `AEOGEO`
   (`red-firefly-93523049`), branch `production`, role `neondb_owner` → reset
   password. Copy the new connection string into your password manager first, not
   into a terminal, a chat, or a file you will forget.

   Do not use `neonctl` for this step. Use the console — `neonctl` prints
   connection URIs to stdout, which is the failure mode that caused the original
   leak this rotation exists to remedy.

2. **Update `MIGRATE_DATABASE_URL`** in `.env.local`. This is the only consumer.

3. **Verify.**

       node --env-file=.env.local scripts/migrate.ts --verify

   Expect every migration to report `recorded`. This single command proves the
   new credential both authenticates and holds DDL rights — no separate check is
   needed.

4. **Confirm the old password is dead.** Attempt a connection with the previous
   DSN and expect authentication failure. If it still works, the reset did not
   take effect and you are not rotated.

## Prevention

Use `scripts/neon` instead of bare `neonctl`. It pipes stdout and stderr through
`scripts/redact.mjs`, so a printed connection URI comes out as
`postgresql://neondb_owner:***@host…`.

Two neonctl behaviours to keep in mind, neither of which the wrapper can fix:

- `neonctl branches create` prints the full connection URI, password included,
  to stdout. Branch roles are inherited, so that is the parent's password.
- `neonctl connection-string --branch-id <id>` returns the **parent's** endpoint,
  not the branch's. A DSN obtained that way can point at production while you
  believe you are on a throwaway branch. Always assert the host before writing.
