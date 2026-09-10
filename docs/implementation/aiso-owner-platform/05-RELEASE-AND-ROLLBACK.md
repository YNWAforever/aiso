# 05 — Release and rollback

Nothing on this branch has been deployed. This is the packet that must be complete
*before* deployment authority is requested, per the plan's §19.5.

## 1. What is releasable today

Commit `379887c` on `claude/fimmick-aiso-phase-0-1-3cf312`, baseline `5bb2dcc`.

| Change | Risk | Notes |
|---|---|---|
| Claim intent mandatory on `/api/scans/[id]/claim` | **behaviour change** | An absent cookie now denies where it previously claimed. See §2. |
| Claim intent mandatory on `/api/onboarding/complete` | **behaviour change** | Same predicate. The onboarding page is currently orphaned — nothing in the app links to it — so the practical blast radius is near zero. |
| `app/api/fix` and `lib/authority/layer2-signals` on the guarded fetcher | low | Outbound requests are now DNS-pinned with revalidated redirects. A target on a private range that previously resolved will now fail, which is the point. |
| Scan compatibility freeze | none | Test only. Adds 38 assertions. |
| SSRF boundary guard test | none | Test only. |
| Phase 0 documentation | none | Docs only. |

**No migration is required to deploy this commit.** It touches no schema.

## 2. The one user-visible risk, and how to watch it

Requiring the claim intent could deny a legitimate claim if the cookie were lost
between minting and claiming. Three things say it will not:

- The cookie is `httpOnly; SameSite=Lax; path=/; max-age=900`. `SameSite=Lax` is
  delivered on top-level navigations, which is exactly what the sign-in return is.
- The only live claim path mints it first: `components/result/AccountUnlockCard.tsx`
  POSTs `/claim-intent`, then `components/result/ClaimScanOnReturn.tsx` POSTs `/claim`
  on return.
- The claim route's 403 body is the fixed string `Claim unavailable`, so it is
  greppable in logs.

**Watch:** the ratio of `403 Claim unavailable` to `200` on `POST /api/scans/*/claim`
for the first 24 hours. A non-trivial 403 rate means the cookie is being lost and the
mint step needs a re-issue path — not that the fix should be reverted.

**Rollback:** revert `379887c`. It is a single self-contained commit and restores the
prior behaviour exactly. Reverting re-opens the claim hole, so it is a last resort,
not a first response.

## 3. Deployment sequence when authority is granted

1. **Development database first.** `npm run migrate -- --verify`, then
   `npm run migrate` to apply `040`–`043`, then `--verify` again. *This is the step
   currently blocked* — see §5.
2. **Integration suite.** `REQUIRE_INTEGRATION_TESTS=1 npm test`. This is the command
   that proves the full suite ran; anything less leaves a skip that reads like a pass.
3. **Preview.** Vercel preview build off this branch. Confirm
   `NEON_AUTH_COOKIE_SECRET` is set and at least 32 characters **at build time** —
   without it `next build` fails collecting page data for `/api/auth/[...path]`.
4. **E2E.** `npm run e2e` against the preview, including the Pixel-5 project.
5. **Dogfood, then pilot.** The Fimmick account first, then 5–10 pilot accounts.

Production remains untouched: Vercel still points at the original production project,
not the AISO development project, and repointing it is a separate cutover decision.

## 4. Flags

`lib/flags.ts` reads `FEATURE_<NAME>` and defaults every flag off. Phase 1 adds
`owner_home_v1`, `asset_sources_v1` and `recheck_compare_v1`. Flags are server-side
only and are **not** a substitute for auth or entitlement.

Turning a flag off must leave evidence and history readable. If an older surface
cannot read a newer record, it gets a read-only fallback rather than an error.

## 5. Authority not held

Two actions are prepared but not taken. Neither is implied by a development request:

| Action | Why it is blocked | What is needed |
|---|---|---|
| `npm run migrate` applying `040`–`043` to the AISO **development** database | attempted; **denied by the permission classifier** | explicit approval to run that one command. Additive only; no destructive statements; each file in its own transaction; recorded in `schema_migrations`. |
| Widening the `no-restricted-globals` fetch rule in `eslint.config.mjs` to `lib/authority/**` and `app/api/**` | `eslint.config.mjs` is protected by the repo's `config-protection` hook | a maintainer applies it, or the hook is disabled for that edit. The equivalent invariant is already enforced by `__tests__/security/no-unguarded-fetch.test.ts`, which runs in the suite that gates a merge. |

Not requested and not authorised by this work: production deployment, production
migrations, live billing changes, external account connections, outbound messages,
and any write to customer content.

## 6. Rollback boundaries

- Reverting the application does **not** undo a migration. `040`–`043` are additive,
  so leaving them applied after an application revert is safe: the tables are simply
  unused.
- Never drop a new table to roll back. Evidence, audit and version history are
  append-only by GRANT and must survive.
- An export that has already been downloaded cannot be recalled. Delivery attestations
  are withdrawable (`work_item_delivery_events` kind `withdraw`), which records that a
  declaration was retracted — it does not undo anything external.
- There is no external write connector in this phase, so no remote content can be left
  inconsistent by a rollback.
