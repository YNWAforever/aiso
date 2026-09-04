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
| `aeo_app` | exists, `rolbypassrls = true`, `rolcanlogin = true` (since 2026-09-05; step 1 is done) |
| synthetic seed | 1 account, 2 clients, 1 scan |
| `migrate --dry-run` | reports `Nothing to apply` |

`aeo_app` cannot log in yet. That is deliberate — see step 1.

Re-running `npm run bootstrap:project` against this branch now refuses, by
design: `Refusing to act: schema public already has 34 table(s)`.

## 1. Give `aeo_app` a password

The baseline creates the role `NOLOGIN` on purpose, so that no secret ever lands
in a tracked file.

**Set the password through Neon, not through SQL:** Neon Console → this project →
Roles → `aeo_app` → Reset password. That grants `LOGIN` as well, so no
`alter role` is needed. Do not reuse the owner password, and do not paste the
value into a shell command — the Neon driver echoes full connection URLs,
password included, in its error messages.

> **This step used to say `alter role aeo_app login password '<generated>'`, and
> that produces a role which works on the direct endpoint and fails on the pooled
> one.** Learned the hard way on 2026-09-05. Neon's proxy authenticates pooled
> connections against the credential its control plane holds; `alter role` changes
> only Postgres's copy, and the two then disagree.
>
> The failure misdirects: `password authentication failed for user 'aeo_app'`
> blames the password when the password is correct and the *endpoint* is the
> variable. The tell is that `…azxacr80.c-3…` connects while
> `…azxacr80-pooler.c-3…` refuses the same value.
>
> SQL remains fine if you only ever connect directly. The application does not —
> `@neondatabase/serverless` wants the pooled endpoint, because direct connections
> have a far lower cap that serverless invocations exhaust. Setting the password
> through Neon makes both endpoint forms work, which is why it is the instruction
> here rather than one of two options.

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
