# AISO Neon topology

**Decided 2026-09-05.** Implements item 1.2 of
`docs/superpowers/plans/2026-08-30-aisogpt-aiso-new-neon-integration.md`.

## The decision

AISO stays a **single Neon project**. Preview branches are cut from its production branch.

| | |
|---|---|
| Project | `weathered-wave-50814522` |
| Production branch | `br-square-mountain-az6f82vi` |
| Endpoint | `ep-mute-firefly-azxacr80` |
| Region | `ap-southeast-1` (AWS — Neon Auth is AWS-only) |

§16.1 of the integration plan recommends a *separate* non-production project, on the grounds that one
must **"never create a preview or test branch from a branch that has held customer data."**

AISO's production branch has held only the synthetic seed — 1 account, 2 clients, 1 scan — and ADR-11
keeps real business writes behind the write-fence gate. The hazard that recommendation guards against
does not currently exist here, so a second project's compute cost and duplicated migration surface
buy nothing yet.

## When this decision expires

**The first real customer write on AISO ends it.** At that moment:

1. Preview branches must stop being cut from `br-square-mountain-az6f82vi`.
2. Create the non-production project §16.1 describes, with a permanently sterile schema-only parent.
3. Repoint `NEON_TEST_PROJECT_ID` / `NEON_TEST_PRODUCTION_BRANCH_ID` and the preview tooling at it.

This is not a caveat on the decision — it is the condition under which the decision stops being
correct. A topology choice recorded without its expiry condition is how a temporary simplification
becomes a permanent hazard.

## Vercel bindings

| Environment | Neon project |
|---|---|
| Production | `red-firefly-93523049` — **unchanged** |
| Preview | `weathered-wave-50814522` (AISO) |
| Development | `weathered-wave-50814522` (AISO) |

**Production stays on the legacy project.** ADR-11 is a dark launch: *"legacy system not retired by
this plan."* Repointing production at AISO is a cutover decision gated on approvals 11 and 12, and
must never happen as a side effect of environment work.

### Checklist for the human doing the binding

Binding is credential-bearing, so it is done by a person and never by tooling in this repo — the same
rule as `docs/runbooks/bootstrap-greenfield-project.md`.

- [ ] Preview: `DATABASE_URL` → AISO's `aeo_app` connection string, **pooled** endpoint (`-pooler`).
      `@neondatabase/serverless` wants the pooled endpoint; direct connections have a far lower cap
      that serverless invocations exhaust.
- [ ] Preview: `MIGRATE_DATABASE_URL` → AISO's `neondb_owner` string, **direct** (no `-pooler`).
      Migrations are DDL in explicit transactions; `aeo_app` cannot perform DDL by design, and
      `scripts/migrate.ts` has no fallback.
- [ ] Development: the same two, same split.
- [ ] **Every environment, including Preview:** `NEON_AUTH_COOKIE_SECRET`, at least 32 characters. It
      is required at **build** time, not merely at runtime — without it a preview deploy fails with
      `Failed to collect page data for /api/auth/[...path]`.
- [ ] Production: **change nothing.**
- [ ] Verify with `node --env-file=.env.local scripts/verify-db-connection.mjs`. Read the **`server`**
      line, which is the database answering `current_user`; the `role` line is only parsed out of the
      URL and proves nothing about what the database agreed to.

Set the `aeo_app` password through **Neon's console**, never `alter role … password`. A password set
via SQL works on the direct endpoint and fails on the pooled one, because Neon's proxy authenticates
pooled connections against its control plane's copy while SQL changes only Postgres's. The resulting
error blames the password when the password is correct — see
`docs/runbooks/bootstrap-greenfield-project.md`.

## Test branching

`__tests__/helpers/neon-branch.ts` defaults `PROJECT_ID` to AISO and `PRODUCTION_BRANCH_ID` to its
default branch. Those two must always move together: the second is a **blocklist entry** naming the
default branch of whichever project the first names, not a parent selector.

`createTestBranch()` passes no `--parent`, so a branch's parent is the project's default branch, and a
Neon branch is a copy-on-write snapshot rather than an empty database — which is why the harness drops
and recreates `public`. Defaulting to a project whose default branch holds customer data would
snapshot real data on every unconfigured run. It did, until 2026-09-05.
