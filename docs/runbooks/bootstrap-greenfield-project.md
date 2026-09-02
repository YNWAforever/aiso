# Runbook: finishing the greenfield project bootstrap

The schema, roles, grants and synthetic seed are installed by
`npm run bootstrap:project` (see `scripts/bootstrap-project.mjs`). Three steps
remain, and all three involve credentials, so they are done by a human and never
by tooling in this repo.

Target project: `weathered-wave-50814522` ("AISO"), branch
`br-square-mountain-az6f82vi`.

## What is already done

Applied 2026-09-02, and verified from a second, independent connection:

| | |
|---|---|
| tables | 34 |
| functions | 49 (11 from the baseline, the rest from `pgcrypto`, created into `public`) |
| `schema_migrations` rows | 37 (36 subsumed migrations + the baseline's own lineage row, checksum present) |
| `aeo_app` | exists, `rolbypassrls = true`, **`rolcanlogin = false`** |
| synthetic seed | 1 account, 2 clients, 1 scan |
| `migrate --dry-run` | reports `Nothing to apply` |

`aeo_app` cannot log in yet. That is deliberate — see step 1.

Re-running `npm run bootstrap:project` against this branch now refuses, by
design: `Refusing to act: schema public already has 34 table(s)`.

## 1. Give `aeo_app` a password

The baseline creates the role `NOLOGIN` on purpose, so that no secret ever lands
in a tracked file. Connect as the owner and run:

    alter role aeo_app login password '<generated>';

Generate it with a password manager. Do not reuse the owner password, and do not
paste it into a shell command — the Neon driver echoes full connection URLs,
password included, in its error messages.

## 2. Bind the application to it

Set `DATABASE_URL` to the **`aeo_app`** connection string (not the owner's) in:

- Vercel: Production, Preview and Development environments
- `.env.local` for local development

`MIGRATE_DATABASE_URL` is the separate **owner** connection string, used only by
`npm run migrate`. `aeo_app` cannot perform DDL, deliberately, and
`scripts/migrate.ts` has no fallback — unset, it fails immediately and names the
variable (`scripts/migrate.ts:190`).

Vercel also needs `NEON_AUTH_COOKIE_SECRET` (at least 32 characters) in every
environment **including Preview**. It is required at *build* time: a preview
deploy without it fails with `Failed to collect page data for /api/auth/[...path]`.

## 3. Verify the binding

    node scripts/verify-db-connection.mjs

It prints two things worth reading separately:

- `role    :` — the username parsed out of the connection string
- `server   :` — what the database itself reports for `current_user`

Both must say `aeo_app`. If either says `neondb_owner`, the application is
running with DDL rights it should not have. Trust the `server` line over the
first: it is the database answering, not the URL.

## What is deliberately not automated

Everything above. A script that set passwords or wrote deployment secrets would
have to handle them, and nothing in this repo should.

## If you need to start over

The project is only safe to rebuild while you are certain nothing depends on it:

    drop schema public cascade; create schema public;

Then re-run `npm run bootstrap:project`. Applying the baseline is all-or-nothing
— Postgres wraps a multi-statement simple Query in an implicit transaction — so
a failed attempt leaves nothing behind rather than a half-built schema.
