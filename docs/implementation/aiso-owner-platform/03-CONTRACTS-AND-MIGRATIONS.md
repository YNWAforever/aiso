# 03 — Contracts and migrations

What the data contracts actually are today, and what Phase 1 adds. Sections 1 and 2
were read from the migration files and the modules named. Section 4 is proposed.

## 1. Migration state — verified

`npm run migrate -- --verify` against the AISO development database, 2026-09-10:

| Range | Objects | Ledger |
|---|---|---|
| `001`–`039` | present | recorded |
| `040`–`043` | **MISSING** | **not recorded** |

The seven missing tables are `client_entities`, `evidence_work_items`,
`work_item_versions`, `account_approver_events`, `account_approver_state`,
`work_item_decisions`, `work_item_delivery_events`, plus three indexes.

Two `--verify` lines look alarming and are not: `014` reports `MISSING plan_features`
because `028` drops that table on purpose, and column-only migrations report `n/a`
because they create no objects to check.

The four pending migrations are **purely additive** — verified by grepping them for
`drop`, `alter … drop`, `truncate` and `delete`, which returns nothing. Applying them
cannot destroy data.

## 2. The contracts that already exist

### 2.1 Scan methodology — frozen

Twenty check keys `c1_robots` … `c20_chunkability`; buckets Core 45 / Extended 30 /
GEO 25; grades A+ ≥ 90, A ≥ 80, B ≥ 70, C ≥ 60, D ≥ 50, else F; scoring
`pass = w, warn = w/2, fail = 0`.

Pinned **by value** in `__tests__/checks/scan-compatibility-freeze.test.ts` (38 tests),
which also asserts that `CHECK_VERSIONS` and migration `041`'s `check_key` CHECK
constraint list the same twenty keys — so the TypeScript registry and the SQL
constraint cannot drift apart.

Changing any of it requires a `SCANNER_VERSION` bump, the affected `CHECK_VERSIONS`
entry, and a dual-version comparison policy, per `docs/adr/ADR-006`.

### 2.2 Evidence — already richer than the brief's vocabulary

    CollectionState    = complete | partial | blocked | failed | unsupported | unknown
    EvidenceAssessment = pass | warn | fail | not-applicable | not-verifiable
    applicability      = applicable | not-applicable | not-verifiable

`lib/scan-evidence.ts` also carries `comparison` + `comparisonSignature` (a SHA-256
over scanner version, all check versions, headline and pillar method, industry,
region, sitemap source and origins), an explicit `limitations` array, and a 32 KiB
budget that throws rather than silently truncating.

The brief's `observed | unavailable | unknown | blocked | estimated | simulated |
planned` maps onto this. Do **not** introduce a second parallel vocabulary;
presentation adapters translate.

### 2.3 Tenancy — composite foreign keys

    foreign key (client_id, account_id) references public.clients (id, account_id)

carried down the chain as
`(account_id, client_id, work_item_id, version_id, content_hash)`. A row of one
account cannot reference another account's parent; Postgres rejects it. There is no
RLS backstop — migration `036` dropped all 30 policies and disabled RLS on 21 tables
— so application filtering plus these FKs are the whole defence.

### 2.4 Immutability — enforced by GRANT, not convention

`042` and `043` grant `aeo_app` **`select, insert` only** on `work_item_versions`,
`work_item_decisions`, `account_approver_events` and `work_item_delivery_events`.
No UPDATE, no DELETE. Editing therefore *must* create version N+1; version N and its
approval are physically unalterable by the application.

### 2.5 Approval binding

`work_item_decisions` binds, structurally: the exact `version_id` **and**
`content_hash` (composite FK into `work_item_versions`), the approver's
`grant_revision` + `grant_event_id` (composite FK into `account_approver_events`),
`actor->>'role' = 'account_approver'`, a `policy_version` inside the version's
`validation` object, and a version-scoped `request_id` for idempotency.

**Not bound:** destination, action type, and an expiry. Acceptable for an export-first
pilot where the destination is "download"; it becomes load-bearing at Phase 4 dispatch.

### 2.6 Delivery

`work_item_delivery_events` is append-only with two kinds. An `attest` requires an
`approved` decision on that exact content hash (composite FK), a destination, a note,
and `delivered_at <= recorded_at` — which is what stops a future-dated publication
claim. A `withdraw` references exactly one attestation and is itself unique.

## 3. What is missing from the contracts

| Contract | Gap |
|---|---|
| Export receipt | The rendered-artifact SHA-256 is computed and returned as `X-Aiso-Export-Sha256`, then discarded. No row records that an export happened. The brief requires the approved-payload hash **and** the artifact hash to be retained separately. |
| Recheck | No `comparison_status`, no `outcome`. `compareScanEvidence()` returns `comparable: false` on every path. |
| Approved sources | No table. `client_entities` is `display_name` + `aliases` + `revision`. |
| Claim replay | `attemptId` is signed into the intent and never persisted, so a token is not single-use. |
| Domain ownership | No verification state. `lib/entities/schema.ts` hardcodes the literal `'unverified'`; nothing can ever change it. |

## 4. Proposed additive migrations

Numbered from `044`. All additive; none alters or drops an existing object. **None has
been written or applied** — they are the contract that Phase 1 slices 4, 6 and 7 need.

**`044_approved_sources.sql`** (package C, slice 6) — the approved facts/FAQ pack.
Composite FK to `clients (id, account_id)`, as `041` does. Columns must carry at
minimum: content plus `content_hash` (SHA-256, the same `^[0-9a-f]{64}$` CHECK shape
used throughout), `version` (integer, monotonic per source), provenance
(`imported_by`, `imported_at`, `import_method`, `origin_ref`), approval
(`approved_by`, `approved_at`), `freshness_state`, `revoked_at` + `revoked_by`, and
`agent_use_allowed boolean not null default false` — default **false**, so a source is
unusable by drafting until someone says otherwise. Grant `select, insert, update`;
never `delete`, so revocation is a state rather than an erasure.

A `work_version` already snapshots its evidence; it must snapshot the source
`(id, version, content_hash)` triple the same way, so revoking a source flags the
drafts that cited it instead of silently changing them.

**`045_export_events.sql`** (package E, slice 7) — append-only export receipts.
Composite FK to `work_item_versions` on
`(account_id, client_id, work_item_id, version_id, content_hash)`, plus
`artifact_hash`, `format`, `renderer_version`, `actor_id` / `actor`, a `request_id`
for idempotency, and `exported_at`. Grant `select, insert` only — the same posture as
`043`.

The recheck adapter (slice 4) needs **no migration**: it reads existing scan envelopes
and the immutable baseline already stored on the work version.

## 5. Migration procedure

1. `npm run migrate -- --verify` first, and trust it over any document.
2. `npm run migrate -- --dry-run` to see the list.
3. `npm run migrate` — each file in its own transaction, in filename order, recorded
   in `schema_migrations`.
4. Re-run `--verify`.

Migrations run as the owner through `MIGRATE_DATABASE_URL`; the application role
`aeo_app` cannot perform DDL, and `scripts/migrate.ts` does not fall back — unset, it
fails immediately and names the variable.

Never paste a connection string into a shell command: the Neon driver echoes the full
URL, password included, in its error messages.
