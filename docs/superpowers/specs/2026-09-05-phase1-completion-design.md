# Phase 1 completion — design

**Status:** Approved 2026-09-05
**Covers:** items 1.2, 1.6, 1.8, 1.10 of `docs/superpowers/plans/2026-08-30-aisogpt-aiso-new-neon-integration.md`
**Unblocked by:** AISO's `aeo_app` credential, fixed 2026-09-05 (PR #11)

## Why these four, now

They are the whole remainder of Phase 1, and all four were gated on the same thing: `aeo_app`
could not log in to AISO, so nothing needing a working application connection could be built or
tested. That is fixed.

The phase is delivered as **four sequenced slices**, not one change. 1.6 and 1.10 both depend on
1.2's topology decision, and 1.6 modifies a file 43 modules import — landing it alone keeps a
revert clean.

## The motivating incident

On 2026-09-05, `.env.local`'s `DATABASE_URL` was found pointing at AISO as **`neondb_owner`** — the
owner role, carrying DDL rights the application is explicitly designed not to have — with a
password rotated out from under it. It had been that way since AISO was bootstrapped on 2026-09-02.

**Nothing caught it.** Not a test, not the application, not CI. It surfaced only because someone
ran `scripts/verify-db-connection.mjs` by hand.

That is the case slice B exists to make impossible, and it is why a CI-only test was rejected: CI
verifies CI's own binding, which was never the one that was wrong.

---

## Slice A — 1.2: topology and bindings

### Decision

AISO (`weathered-wave-50814522`) stays a **single project**. Its production branch
(`br-square-mountain-az6f82vi`) is the root, and preview branches are cut from it.

§16.1 recommends a separate non-production project, on the grounds that one must *"never create a
preview or test branch from a branch that has held customer data."* AISO's production branch has
held only the synthetic seed — 1 account, 2 clients, 1 scan — and ADR-11 keeps real business writes
behind the write-fence gate. The hazard that recommendation guards against does not currently
exist, so a second project's cost and duplicated migration surface buy nothing yet.

### The expiry trigger, which is part of the decision

**The moment AISO takes its first real customer write, preview branches must stop being cut from
its production branch,** and the topology moves to §16.1's two-project shape with a permanently
sterile schema-only parent.

This is not a caveat; it is the condition under which the decision above stops being correct.
Recording it is the deliverable. A topology choice without its expiry condition is how a temporary
simplification becomes a permanent hazard.

### Vercel

- **Preview** and **Development** bind to AISO.
- **Production stays bound to `red-firefly-93523049`.** ADR-11 is a dark launch: *"legacy system
  not retired by this plan."* Repointing production at AISO is a cutover decision requiring approval
  gates 11 and 12. It is not part of Phase 1 and must not happen as a side effect of it.

Vercel binding is credential-bearing and so is performed by a human, per
`docs/runbooks/bootstrap-greenfield-project.md`'s standing rule that nothing in this repo should
handle deployment secrets. This slice delivers the topology document and the binding checklist, not
the binding.

### Also delivered

The guard's expected-value variables, documented in `.env.example` with what breaks without each.

---

## Slice B — 1.6: the runtime binding guard

### Shape

A new `lib/security/db-binding.ts` holds the comparison as a **pure function** — expected tuple in,
verdict out — so every mismatch case is unit-testable without a database.

`lib/db.ts` gains a `Proxy`. `db()` stays **synchronous** and no caller changes; the returned
tagged-template function awaits a memoized guard promise before delegating its first query.

This is the only placement that genuinely fails closed. `instrumentation.ts` would detect a
misbinding alongside serving rather than before it, and an unawaited check races the queries it is
meant to gate.

### The identity tuple

Project id, branch id, `current_user`, `current_database()`.

> **Unverified, and the first implementation step must settle it.** §16.1 asserts that Neon exposes
> `neon.project_id` and `neon.branch_id` as in-band GUCs. That has **not** been confirmed against
> AISO. Step one of this slice is to run `select current_setting('neon.project_id', true)` and see
> whether a value comes back.
>
> If it does not, the tuple falls back to **endpoint host + role + database**, all obtainable
> without a control-plane call. §16.1 explicitly permits this — *"or an immutable environment
> sentinel."* The design is unchanged either way; only the tuple's contents differ. Do not build on
> the GUCs before checking.

In-band settings are preferred to control-plane metadata deliberately: no API key, no network
dependency, and nothing external flaky enough to take a fail-closed guard down.

### Both directions, per §16.1

| | |
|---|---|
| **Positive allow-list** | the connection *is* the expected project / branch / role / database |
| **Negative blocklist** | the connection is *not* the old project id, branch id, or endpoint host |

Both are required. §16.1's reasoning: a blocklist alone would accept an unrelated third project; an
allow-list alone would not catch a stale binding that happens to match.

### Which expectations are mandatory

This is what lets the guard survive the integration harness instead of being switched off by it.

| variable | required | checked |
|---|---|---|
| `EXPECTED_NEON_PROJECT_ID` | **yes** — guard throws if unset | always |
| `EXPECTED_NEON_BRANCH_ID` | no | when set |
| `EXPECTED_DB_ROLE` | no | when set |
| `EXPECTED_DB_NAME` | no | when set |
| `FORBIDDEN_NEON_PROJECT_IDS` | no | always, when non-empty |
| `FORBIDDEN_NEON_BRANCH_IDS` | no | always, when non-empty |
| `FORBIDDEN_DB_HOSTS` | no | always, when non-empty |

The three `FORBIDDEN_*` variables are **comma-separated lists**, and together they satisfy §16.1's
requirement to reject *"the old project id, old branch id, and old endpoint host"* — three
dimensions, not one. Matching **any** entry in **any** of them fails the guard, regardless of
whether the positive expectations also matched: a connection that is somehow both expected and
forbidden is a configuration error, and the safe reading is the forbidding one.

Ephemeral integration branches live **inside** the AISO project, so the project id still matches
while the branch id varies per run. The harness sets the project expectation and omits the branch
one, and the guard stays fully armed throughout integration runs.

**There is no opt-out flag.** An opt-out is what eventually gets set in production by accident, and
a guard that can be disabled by an environment variable is a guard that will be.

### Error handling

A mismatch **throws**, naming the field with both expected and actual values. Project ids, branch
ids, role names and database names are **not secrets** and belong in the message — a guard that says
only "binding mismatch" wastes the reader's time.

The DSN and password never appear. That is precisely the rule the Neon driver's own error messages
break, which is why `lib/security/redact-secrets.ts` exists; the guard's error path routes through
it.

A failure of the guard's own query also **fails closed**. A database that cannot answer a trivial
query cannot serve the request either, so this costs nothing real.

### Testing

Unit, against a mocked `sql`: wrong project, wrong branch, wrong role, wrong database, blocklisted
project, missing mandatory expectation, and the GUC-absent fallback path.

Integration: accepts AISO, rejects a forged expectation.

---

## Slice C — 1.8: role and grant tests

Mirrors `__tests__/integration/least-privilege-role.test.ts` against AISO.

**Allowed** — DML on `public`; sequence usage; `SELECT` on `neon_auth."user"` (required by the Neon
webhook, which ships no payload signing and authenticates every payload against that table, and by
alert recipient lookup); default privileges for future tables.

**Forbidden** — DDL; role creation; writes to `neon_auth`.

**Every denial is asserted by its specific error message.** A bare "it threw" also passes on a wrong
password, which is the whole reason the existing test is written that way — and this session is a
live demonstration that a wrong credential is not hypothetical.

`BYPASSRLS` is re-asserted with `037`'s fail-closed check. Seven tables have RLS enabled with zero
policies; a non-bypass role reads **zero rows from them silently** rather than erroring, which is the
failure mode `036` spent a migration eliminating elsewhere.

---

## Slice D — 1.10: preview branch lifecycle

Scheduled cleanup of preview branches past their TTL, with orphan recovery.

The existing harness already surfaces orphaned branch ids prominently on delete failure. That
behaviour is kept — an orphaned branch whose id is lost must be hunted down by hand in the console.

**The never-delete-production guard is the one unrecoverable bug in this slice**, so it is written
as an explicit allow-list of what may be deleted rather than a blocklist of what may not, and it is
unit-tested directly. A cleanup job that can delete the production branch is worse than no cleanup
job.

TTL arithmetic is unit-tested in isolation — it needs no Neon API call to verify, and a wrong
comparison either deletes live branches or never deletes anything.

---

## Sequencing

**A → B → C → D.** C does not strictly depend on A or B and could run in parallel, but the phase is
small enough that sequential ordering costs little and keeps each slice's verification unambiguous.

## Risk

**Slice B wraps a third-party driver used by 43 modules.** The failure mode is not subtle —
`.transaction()` breaking would fail loudly across the suite — but it is the riskiest change here,
which is why it lands alone.

## Out of scope

- **Repointing Vercel production at AISO.** ADR-11; approval gates 11 and 12.
- **Item 1.11**, the fresh-project bootstrap rehearsal gate. It depends on 1.3–1.9 and belongs to its
  own slice once these land.
- **n8n's stored Postgres credential** and the **MCP server's `DATABASE_URL`**, both still listed
  unverified in `docs/runbooks/roll-out-least-privilege-role.md`.
- **The n8n bearer JWT still reachable at `bcbe9dc`**, which carries no `exp` claim and remains owed
  a rotation.
