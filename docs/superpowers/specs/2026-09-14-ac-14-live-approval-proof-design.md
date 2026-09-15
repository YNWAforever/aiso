# AC-14: proving the two verbs, live

## What this closes

AC-14 asks for mobile review, approve and request-changes. The journey has run
against a real session and database since 2026-09-11 — `owner-review.spec.ts`,
3/3 — but the captured session was always the submitter's. `can_decide`
correctly took its denial branch: a submitter cannot approve their own version
(AC-08), so the two verbs AC-14 is named after were never exercised, only
displayed as reachable when the controls happen to render.

What was missing was not code. It was a second real person: `can_decide`
requires an actor who is neither the submitter nor unapproved, and until
migration `047` (account invitations) there was no way to produce that second
person inside a single account at all. `047` and `048` merged before this
session, and the domain-verification/claim-replay work (`044`) that finished
this same day is unrelated but landed alongside it. The capability has existed,
unexercised, since before this design started.

This is not a capability gap. It is a proof gap, and closing it needs one real
second sign-in.

## Decisions taken

1. **A second Playwright-captured session, not a mocked one.** AC-14 is
   specifically "on a phone, against a real session" — the existing spec's own
   framing. An approval proved through a raw API call would prove the API, not
   AC-14.
2. **One test, two browser contexts, not two test runs.** The story is
   sequential — owner submits, approver decides — and two independently
   scheduled Playwright projects would have to coordinate through shared
   database state with no ordering guarantee between them.
3. **Granting `account_approver` is manual and out of band, not part of the
   automated test.** It needs a `platform_admin` profile and happens once,
   the same way the capture itself is a one-time human act the tooling
   deliberately does not automate.

## Rejected alternative

**Mock the approver via `page.request.post()` on the decide endpoint,
using the owner's context.** Simplest to build, and wrong for what AC-14
tests: it would prove the store function, which `__tests__/integration/
change-set-stores.test.ts` already does against real Postgres, not that a
second person can reach and operate the decision controls on a phone. The
entire reason this test family exists is that pre-built-HTML specs never
reach anything behind `requireAuth`; a mocked second actor reintroduces
exactly that gap for the half of the flow that matters most.

## One-time setup (manual, run once, not part of the automated suite)

This mirrors `capture-auth-state.mjs`'s own stated boundary: the tooling does
not sign anyone in, and does not pretend to.

1. **Invite.** The existing captured owner session sends an invitation to a
   second real email address — through the Members panel, or directly:
   ```
   POST /api/account/invitations
   { "email": "<second address>" }
   ```
2. **Capture the second identity.** Reuses `capture-auth-state.mjs` unchanged —
   it already reads `PLAYWRIGHT_STORAGE_STATE`, so a second output path is the
   only new input:
   ```
   PLAYWRIGHT_STORAGE_STATE=.auth/approver-state.json npm run e2e:auth:capture
   ```
   Signing in with the invited address is what consumes the invitation and
   diverts `provisionAccountForUser` into the existing account, per migration
   `047`'s own mechanism — no separate "accept" step exists or is needed.
3. **Grant approver access.** Through a normal, non-Playwright browser, signed
   in as a `platform_admin` profile:
   ```
   /admin/accounts/[accountId]/approvers
   ```
   grant the newly-joined profile `account_approver`. This is the one step
   with no Playwright involvement at all — it needs to have *happened*, not
   to be automated, and automating it would need a third identity (an admin
   session) for a capability this design does not otherwise need.

Steps 1–3 run once. Every later `npm run e2e:authenticated` replays both
captured files as-is; the invitation is already consumed and the grant
already recorded, so nothing in this sequence repeats per run.

## The E2E spec

New tests in `tests/e2e/authenticated/owner-review.spec.ts` (alongside, not
replacing, the existing three — they still cover the submitter's denial
branch, Home, and the approved-facts surface). `APPROVER_STATE_PATH` is a
module-level constant in the spec file itself, declared the same way
`capture-auth-state.mjs` and `playwright.config.ts` each locally declare their
own copy of the owner path — `process.env.PLAYWRIGHT_APPROVER_STORAGE_STATE?.trim()
|| '.auth/approver-state.json'` — rather than importing one from another file,
matching the existing triplicated-constant convention.

**Two separate `test()` blocks, not one test making two decisions** — a
decision is terminal for the version it names, so approving one version and
requesting changes on another each need their own freshly-submitted version to
act on; a single test deciding twice on the same version would just prove the
second call rejected an already-decided one.

```
test('an approver can approve a real version, on a phone', async ({ authenticatedPage: page, browser }) => {
  const clientId = await openFirstBrand(page)
  // ...locate or require a submitted version, exactly as the existing test does
  // ...navigate to it, open the version, confirm decision controls render

  const approverContext = await browser.newContext({ storageState: APPROVER_STATE_PATH })
  const approverPage = await approverContext.newPage()
  await approverPage.goto(`/en/dashboard/${clientId}/work-items/${itemId}/versions`)
  // ...select the same version; assert canDecide renders true here specifically
  //    (today's test only asserts this conditionally, for whichever branch the
  //    single captured session happens to land in)

  // Decision, reason, Record decision — for real, not just presence-checked
  // Verify: the page reflects the recorded decision afterward (re-navigating
  // shows canDecide: false, or a decision entry appears in history)

  await approverContext.close()
})
```

A second `test('an approver can request changes on a real version, on a phone', ...)` follows the identical shape against its own freshly-submitted version, selecting `option[value="changes_requested"]` instead of `"approved"` before clicking **Record decision**. Both matter: AC-14 names both verbs, and request-changes exercises a different combobox option and a different post-decision state than approve does.

Setup within the test reuses `openFirstBrand`, `productButtons`, and the
existing "no submitted version — create one first" refusal pattern rather
than duplicating them.

## Config change

`playwright.config.ts` gains a second existence gate, mirroring `authStatePath`
exactly:

```ts
const approverStatePath = process.env.PLAYWRIGHT_APPROVER_STORAGE_STATE?.trim() || '.auth/approver-state.json'
const approverConfigured = existsSync(resolve(process.cwd(), approverStatePath))
```

The new decision test is gated on **both** `authenticatedConfigured` and
`approverConfigured`. Gated on file existence, not a separate flag — the same
reasoning `authStatePath` already documents: a variable pointing at nothing
must fail loud as a missing file, not read as deliberately unconfigured.

If only the owner capture exists (today's state), the suite runs exactly as it
does now — the new test does not exist to Playwright at all, so it cannot skip
and cannot silently pass.

## Scope boundaries

**In scope:** the second capture path (config only, no new script), the new
spec proving both verbs, the runbook documenting the three manual setup steps.

**Out of scope, deliberately:**
- Automating the invite-accept-grant sequence. It is a one-time human act by
  design, the same as the first capture.
- A third (admin) captured session. The grant is a real-browser, one-time
  action; adding Playwright automation for it would add a capability this
  design does not need to prove anything.
- Any change to `can_decide`'s SQL, `mutateApproverAccess`, or the
  invitation/membership code paths themselves. All of it already exists and
  is already proven against real Postgres in
  `__tests__/integration/second-approver.test.ts` and
  `__tests__/integration/change-set-stores.test.ts`. This design proves the
  UI can reach it, not that the capability exists.

## Testing plan

- The new spec runs under the existing `authenticated-mobile` Playwright
  project (Pixel 5), gated as above.
- `__tests__/config/playwright-projects.test.ts` already fails any configured
  project that resolves to zero tests — no new assertion needed there, since
  the new test lives inside the same spec file the project already matches.
- Manual verification is the capture itself: a human completes the three
  setup steps once, runs `npm run e2e:authenticated`, and records the result
  (pass or the specific failure) in the AC-14 acceptance-matrix row, the same
  way the original three-test run was recorded on 2026-09-11.
