# Site-edit S1 — structured JSON-LD edit spec in review versions

- Brief: `docs/superpowers/plans/2026-11-03-aiso-brief-post6-site-edit.md` (§3.1, §6 S1)
- ClickUp: [z8qgvcahq6](https://app.clickup.com/t/z8qgvcahq6)
- Lock: Willy answering **t223s832**: «MCP = **act／edit**», non-goal «unbounded "change any website"».
- Decisions (Willy, 2026-11-03): option **E** (executor hand-off), **JSON-LD first**, **no new flag**; S1 started on Willy's named start.
- Base: `main@041d3bf56f43d4b201890bedbde1919bc1dd48c0`

## What S1 does

A work-item draft may carry **one** structured edit: a JSON-LD block for one page
on the brand's **verified** domain. On submit, it is frozen into the C9d review
version, so the content hash, and therefore the independent approval, covers
exactly that markup. The approved-package export (C9e) carries it, so even
before any executor exists, a person delivering by hand gets the exact JSON-LD.

**Nothing in S1 contacts a site or an executor.** S2 (hand-off) and S3 (signed
receipts) wait on brief Q1; S4 adds the live-page verification.

## Contract (`lib/site-edit/edit-spec.ts`, shared by editor and server)

```ts
{ schemaVersion: 1, kind: 'jsonld', targetUrl, schemaType: 'FAQPage' | 'Organization' | 'LocalBusiness', payload }
```

- **Strict keys.** `targetUrl` must be https, at most 2,048 characters, with no credentials, port or fragment.
- `payload` must be an object:
  - its `@context` must be `https://schema.org`, and its `@type` must equal `schemaType`;
  - limits: at most 16 KiB serialized, depth at most 8, at most 500 nodes;
  - finite numbers only, NFC strings.
- **Markup breakout refused.** Any key or value containing `</script` or `<!--` is rejected, because the executor embeds JSON-LD inside `<script>`.
- **Canonical.** Object keys are deep-sorted, so equal specs hash equally, and freeze refuses a stored spec that isn't already canonical.
- **Domain.** The target host must be the brand's **verified** domain (`053`) or its `www.` host. Any other subdomain is refused.
  - This is checked on **draft save**: `409 EDIT_SPEC_DOMAIN_UNVERIFIED` or `400 EDIT_SPEC_DOMAIN_MISMATCH`.
  - It is checked **again at submit**. A failure there freezes nothing (`validation_failed`), and a failed domain lookup fails closed as `CHANGE_SET_UNAVAILABLE`.
  - A historical version is never re-checked on read: its approval stands for what it was approved against.

## Hash and history invariants

- `editSpec` is added to review content **only when present**. Hashing is canonical, so every spec-less version's content and hash are byte-identical to before. All existing work-item, change-set, delivery, outcome and approval suites (584 tests) pass unchanged.
- `versionDTO` re-freezes with the stored spec, so a tampered spec fails the hash check and the row is refused (`CHANGE_SET_UNAVAILABLE`).
- The submit write statement additionally requires `d.edit_spec IS NOT DISTINCT FROM <frozen spec>`, so a concurrent draft edit cannot slip a different spec under the frozen hash.
- The draft PATCH treats `editSpec` as optional:
  - absent → unchanged;
  - `null` → clear;
  - object → validated and stored.

  The replay branch matches on the spec too, so a retry with the same text but a different spec is a conflict.
- The text budget stays 32 KiB, measured without the spec. The PATCH transport cap rose to 64 KiB, to fit text plus a spec of up to 20 KiB.
- `validation.checks` is pinned by `042`'s CHECK to four entries, so no fifth check code was added. Spec validity is enforced inside freeze.

## Data

`086_work_item_edit_specs.sql` (**file only**; not applied to any hosted database):

- adds `evidence_work_items.edit_spec jsonb` (nullable), with a shape CHECK;
- adds a **separate** constraint on `work_item_versions` that validates `content->'editSpec'` whenever it is present.

No new tables, no grants change. The number skips `085`, which is authored on open PR #142; the runner applies whatever the ledger lacks, in filename order.

## UI

- **Draft editor:** a collapsed "Site edit (JSON-LD)" section with an include toggle, schema type, page URL and a JSON-LD textarea. It opens automatically when the draft already has a spec. Specific errors cover invalid specs, an unverified domain and an off-domain URL. Edits are preserved on every error.
- **Version details:** the frozen spec (type, URL, pretty-printed JSON-LD in a focusable scroll region) appears only on versions that carry one.

## Tests

- `__tests__/site-edit/edit-spec.test.ts`: every acceptance and refusal rule, canonical order, and the domain match (exact, `www.`, lookalikes).
- `__tests__/site-edit/review-freeze.test.ts`:
  - edit input semantics (absent / null / object, text budget unchanged);
  - spec-less hash identical, spec frozen and hash moved, multi-source path;
  - non-canonical or invalid stored spec refused;
  - `versionDTO` round trip and tamper refusal;
  - export carries the spec;
  - spec-less export unchanged.
- `__tests__/site-edit/write-gates.test.ts`:
  - domain gate at draft save (ok, unverified 409, mismatch 400, no check to keep or clear);
  - submit freezes and pins `edit_spec`;
  - submit refuses an unverified or mismatched domain;
  - a failed lookup fails closed;
  - spec-less submit pins NULL.
- `__tests__/site-edit/edit-spec-sql.test.ts`:
  - PGlite applies `086` on minimal work-item and version tables;
  - the real `updateOwnedDraft` / `readOwnedDraft` store, keep, replace, clear and replay correctly;
  - both CHECKs hold.
- `__tests__/site-edit/edit-spec-render.test.tsx`: editor and version views in both locales, with escaping.

## HOLD / NO_GO

- No executor or site contact.
- No new `FEATURE_*`.
- No hosted Neon migrate.
- No LIVE / env / Vercel change.
- No merge.

## Rebuild after #143 (review fixes)

#143 was merged before 086 was applied and reverted in #144. This rebuild carries the
Extra High review's fixes:

- **Deploy order:** apply `086` to the target database *before* this code deploys. Every
  work-item query reads `edit_spec`; without the column they all fail.
- A frozen version is compared to its re-freeze by canonical JSON, not key order, because
  jsonb reorders keys on storage. Covered by a PGlite round-trip test through `versionDTO`
  and the delivery export.
- Payload keys and values refuse U+0000, lone surrogates and the other control characters
  the text fields refuse (400, not a 503 from the database). Tab/LF/CR stay allowed.
- A target URL with a bare trailing `#` is refused.
- The www/apex pair is accepted either way round, through the same host normalizer the
  domain verification uses (`lib/site-edit/target-domain.ts`).
- Submit pins the client domain and verified domain the check saw inside the INSERT.
- The editor does not re-send an untouched spec (a text-only save skips the domain check),
  and validates the text fields first so a bad title is not reported as a site-edit error.
