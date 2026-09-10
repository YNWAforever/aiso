import type { Page } from '@playwright/test'
import { test, expect } from '../../fixtures/auth'

/**
 * AC-14: review and approve, on a phone, against a real session and database.
 *
 * Every other spec in this repo renders pre-built HTML into a blank page and
 * aborts all network. That is a real check of markup at a viewport, and it is not
 * a journey — nothing behind `requireAuth` is ever reached, no route handler runs,
 * no query executes. CI's Pixel-5 project is green today entirely on that basis,
 * which is why AC-14 stayed BLOCKED rather than quietly passing.
 *
 * This one navigates the live app carrying a session a human captured once. It
 * runs only in the `authenticated-mobile` project, which exists only when that
 * capture exists.
 *
 * These tests FAIL rather than skip when the data they need is absent. A skip
 * would return AC-14 to the state it just left: indistinguishable from a pass.
 */

async function openFirstBrand(page: Page): Promise<string> {
  const brand = page.getByRole('link', { name: /dashboard\/|brand/i }).first()
  expect(
    await brand.count(),
    'No brand is reachable from the dashboard. Create one before this gate can mean anything.',
  ).toBeGreaterThan(0)

  await brand.click()
  await page.waitForURL(/\/en\/dashboard\/[^/]+/)
  return new URL(page.url()).pathname.split('/')[3]!
}

test.describe('the owner journey on a phone', () => {
  test('Home leads with priorities and a single next action', async ({ authenticatedPage: page }) => {
    // The fixture has already proven the session by reaching /en/dashboard.
    await openFirstBrand(page)

    await expect(page.getByRole('main')).toBeVisible()

    // Whatever state the account is in, Home must say which it is. The failure
    // this guards is an empty priorities list reading as "your site is fine".
    const priorities = page.locator('section[aria-labelledby="priorities-heading"]')
    await expect(priorities).toBeVisible()
    await expect(priorities).not.toBeEmpty()
  })

  test('the approved-facts surface states the gate and is operable by thumb', async ({ authenticatedPage: page }) => {
    const clientId = await openFirstBrand(page)
    await page.goto(`/en/dashboard/${clientId}/sources`)

    const main = page.getByRole('main')
    // The sentences that stop an owner believing one toggle is the whole story,
    // and that an import is a live connection. If the page 503s, this fails —
    // which is the correct outcome, not a reason to soften the assertion.
    await expect(main).toContainText('quoted only when all three are true', { timeout: 15_000 })
    await expect(main).toContainText('imports, not connections')

    // Review happens on a phone; a 24px control is not reviewable.
    for (const control of await page.getByRole('button').all()) {
      const box = await control.boundingBox()
      if (box) expect(box.height, 'a control smaller than a thumb').toBeGreaterThanOrEqual(40)
    }
  })

  test('a version can be reviewed and its decision controls reached', async ({ authenticatedPage: page }) => {
    const clientId = await openFirstBrand(page)

    const response = await page.request.get(`/api/clients/${clientId}/work-items`)
    expect(response.ok(), `work-items answered ${response.status()} for an owned client`).toBe(true)
    const items = (await response.json()).items ?? []

    // Named precisely rather than skipped. AC-14 is not satisfied by a green run
    // over an account with nothing to approve, and saying so plainly is the only
    // honest way to leave this test.
    expect(
      items.length,
      'No work item exists to review. Create one (Opportunities -> draft -> submit a version), then re-run: AC-14 is about approving a real version on a phone.',
    ).toBeGreaterThan(0)

    await page.goto(`/en/dashboard/${clientId}/work-items/${items[0].id}/versions`)
    await expect(page.getByRole('main')).toBeVisible({ timeout: 15_000 })

    // Counting buttons here proved nothing. VersionWorkspace seeds `selected`
    // from an `initialVersion` prop the page never passes, and it has no effect
    // that auto-selects — so on first paint the whole `{selected && (…)}` block,
    // decision controls included, is absent. "Submit saved version", "Reload
    // draft" and "Reload history" satisfied a `count() > 0` on their own, and the
    // comment above it claimed the decision controls were reachable while
    // checking nothing of the sort. The history list has to be clicked.
    const versions = page.getByRole('button', { name: /^Version \d+ ·/ })
    expect(
      await versions.count(),
      'No submitted version to review. Submit one from the draft, then re-run: AC-14 is about deciding on a real version, and an item with no version renders "No submitted versions." instead.',
    ).toBeGreaterThan(0)

    await versions.first().click()

    // Opening the detail region is the proof that `selected` is set — this is
    // what the old assertion silently skipped past.
    const details = page.getByRole('region', { name: 'Immutable version details' })
    await expect(details).toBeVisible({ timeout: 15_000 })

    // Now the branch. Both outcomes are correct product states and which one a
    // captured session lands in cannot be known before a human captures it:
    // lib/change-sets/store.ts computes can_decide as no-decision AND latest
    // version AND submitter <> actor AND an active account_approver grant. A
    // single owner who submitted the version they are looking at gets the denial,
    // by design — separation of duties is AC-08, and asserting the controls
    // unconditionally would fail against a correct product.
    const recordDecision = page.getByRole('button', { name: 'Record decision', exact: true })
    const denied = page.getByText(
      'An independent, active account approver must review the latest version.',
      { exact: false },
    )

    const canDecide = (await recordDecision.count()) > 0
    if (!canDecide) {
      // Not a skip: the page must SAY why, in the words the product uses.
      await expect(
        denied,
        'Neither the decision controls nor the separation-of-duties denial rendered — the version surface is silent about what this owner may do.',
      ).toBeVisible()
      return
    }

    // AC-14's two verbs, on the live page: both options must actually be
    // offered, and the reason the server requires must be typable.
    const decision = page.getByLabel('Decision', { exact: true })
    await expect(decision).toBeVisible()
    await expect(decision.locator('option[value="approved"]')).toHaveCount(1)
    await expect(decision.locator('option[value="changes_requested"]')).toHaveCount(1)
    await expect(page.getByLabel('Review reason', { exact: true })).toBeVisible()

    // Operable by thumb. The sources test's loop covers `button` only, which
    // excludes exactly these two: the decision is a combobox and the reason a
    // textbox, so the controls AC-14 is named after were the ones never measured.
    for (const control of [decision, page.getByLabel('Review reason', { exact: true }), recordDecision]) {
      const box = await control.boundingBox()
      if (box) expect(box.height, 'a decision control smaller than a thumb').toBeGreaterThanOrEqual(40)
    }
  })
})
