import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'
import {
  draft,
  clientId,
  version,
  initial,
  access,
} from '../../__tests__/components/c9d-fixtures'
import { outcome } from '../../__tests__/components/c9f-fixtures'
import type { VersionDetail } from '../../lib/change-sets/types'
import type { VersionWorkspaceProps } from '../../components/change-sets/VersionWorkspace'
const errors = new WeakMap<Page, string[]>()
async function fixture(
  page: Page,
  lang: string,
  slice = 'C9D',
  variant = 'default',
) {
  const dir = process.env[slice + '_HTML_DIR'],
    css = process.env[slice + '_CSS_PATH']
  if (!dir || !css) throw Error('C9d fixture paths required')
  const pageErrors: string[] = []
  errors.set(page, pageErrors)
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/*', (route) => route.abort())
  await page.route(`https://review.fixture/${lang}`, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Review fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${readFileSync(css, 'utf8')}</style></head><body>${readFileSync(dir + '/' + lang + '-' + variant + '.html', 'utf8')}<script>${readFileSync(dir + '/fixture.js', 'utf8')}</script></body></html>`,
    }),
  )
  await page.route('**/versions/*/delivery', route => route.fulfill({ json: { events: [], activeAttestationId: null, nextCursor: null, capabilities: { canExport: false, canAttest: false, canWithdraw: false, attestReason: 'not_approved', withdrawReason: 'no_active_attestation' } } }))
  await page.route('**/versions/*/outcomes', route => { const parts = new URL(route.request().url()).pathname.split('/'); return route.fulfill({ json: outcome({ clientId: parts[3], itemId: parts[5], versionId: parts[7], anchorState: 'no-delivery', anchor: null }) }) })
  await page.goto(`https://review.fixture/${lang}`)
  await page.waitForFunction(() =>
    Boolean((window as Window & { c9cFixtureReady?: boolean }).c9cFixtureReady),
  )
  const delivery = page.locator('section[aria-label]').filter({ has: page.getByRole('heading', { name: lang === 'en' ? 'Manual delivery' : '手動交付', exact: true }) })
  if (await delivery.count()) await expect(delivery).toHaveAttribute('aria-busy', 'false')
  const messages = lang === 'en' ? en : zh
  expect(
    JSON.parse(readFileSync(dir + '/' + lang + '-copy.json', 'utf8')),
  ).toEqual(
    slice === 'C9D'
      ? messages.changeSets
      : slice === 'C9D_APPROVERS'
        ? messages.approverAccess
        : messages.opportunities,
  )
  return messages
}
test.afterEach(({ page }) => expect(errors.get(page) ?? []).toEqual([]))
for (const lang of ['en', 'zh-HK']) {
  test(`C9d saved submission conflict, explicit revision reload and immutable history ${lang}`, async ({
    page,
  }) => {
    const { changeSets: c } = await fixture(page, lang)
    let posts = 0
    const newer = {
      ...version,
      id: '66666666-6666-4666-8666-666666666666',
      versionNumber: 2,
      draftRevision: draft.revision + 1,
      title: 'New saved title',
      capabilities: { canDecide: false },
    }
    await page.route('**/api/clients/*/work-items/*/versions', (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: initial })
      posts++
      expect(route.request().postDataJSON()).toEqual({
        expectedRevision: posts === 1 ? draft.revision : draft.revision + 1,
      })
      return route.fulfill(
        posts === 1
          ? { status: 409, json: { error: 'CHANGE_SET_CONFLICT' } }
          : { status: 201, json: { version: newer } },
      )
    })
    await page.route('**/api/clients/*/work-items/*', (route) =>
      route.fulfill({
        json: {
          item: {
            ...draft,
            title: 'New saved title',
            revision: draft.revision + 1,
          },
        },
      }),
    )
    await page
      .getByRole('button', { name: c.submitVersion, exact: true })
      .click()
    await expect(page.getByRole('alert')).toHaveText(c.conflict)
    await expect(
      page.getByRole('heading', { name: draft.title, exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: c.reloadDraft, exact: true }).click()
    await expect(page.getByRole('status')).toHaveText(c.draftReloaded)
    await page
      .getByRole('button', { name: c.submitVersion, exact: true })
      .click()
    await expect(page.getByRole('status')).toHaveText(c.versionSubmitted)
    expect(posts).toBe(2)
    await expect(page.getByText(c.notDelivery, { exact: true })).toBeVisible()
    await page.route('**/versions/' + version.id, (route) =>
      route.fulfill({
        json: { version: { ...version, capabilities: { canDecide: false } } },
      }),
    )
    await page
      .getByRole('button', {
        name: new RegExp((lang === 'en' ? 'Version 1' : '版本 1') + ' ·'),
      })
      .click()
    await expect(page.getByText(version.title, { exact: true })).toBeVisible()
    await expect(page.getByText(c.superseded, { exact: true })).toBeVisible()
    await expect(page.locator('script:not([id])')).toHaveCount(1)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })
  for (const decision of ['approved', 'changes_requested'] as const)
    test(`C9d ${decision} timeout retry retains exact request and focus ${lang}`, async ({
      page,
    }) => {
      const { changeSets: c } = await fixture(page, lang)
      const bodies: Record<string, unknown>[] = []
      await page.route('**/versions/*/decision', (route) => {
        const body = route.request().postDataJSON()
        bodies.push(body)
        expect(body).toEqual({
          decision,
          reason: 'Review reason',
          requestId: expect.any(String),
        })
        expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/)
        return route.fulfill(
          bodies.length === 1
            ? { status: 503, json: { error: 'CHANGE_SET_UNAVAILABLE' } }
            : {
                status: 200,
                json: {
                  version: {
                    ...version,
                    decision: {
                      decision,
                      reason: body.reason,
                      decidedBy: {
                        profileId: clientId,
                        displayName: 'Independent reviewer',
                        role: 'account_approver',
                      },
                      decidedAt: '2026-09-07T00:00:00Z',
                    },
                    capabilities: { canDecide: false },
                  },
                },
              },
        )
      })
      await page.getByLabel(c.decision, { exact: true }).selectOption(decision)
      const reason = page.getByLabel(c.reason, { exact: true })
      await reason.fill('  Review reason  ')
      await page
        .getByRole('button', { name: c.recordDecision, exact: true })
        .focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('alert')).toHaveText(c.unavailable)
      await expect(reason).toHaveValue('  Review reason  ')
      await expect(reason).toBeFocused()
      await reason.fill('Review reason')
      await page
        .getByRole('button', { name: c.recordDecision, exact: true })
        .click()
      await expect(page.getByRole('status')).toHaveText(c.decisionRecorded)
      await expect(page.getByRole('status')).toBeFocused()
      expect(bodies).toHaveLength(2)
      expect(bodies[1]).toEqual(bodies[0])
      await expect(
        page.getByRole('button', {
          name: new RegExp((lang === 'en' ? 'Version 1' : '版本 1') + ' ·'),
        }),
      ).toHaveCount(1)
    })
  test(`C9d changed reason rotates request identity, revoked write preserves text ${lang}`, async ({
    page,
  }) => {
    const { changeSets: c } = await fixture(page, lang)
    const bodies: Record<string, unknown>[] = []
    await page.route('**/versions/*/decision', (route) => {
      bodies.push(route.request().postDataJSON())
      return route.fulfill({
        status: bodies.length === 1 ? 409 : 403,
        json: { error: 'CHANGE_SET_DENIED' },
      })
    })
    await page.getByLabel(c.reason, { exact: true }).fill('First reason')
    await page
      .getByRole('button', { name: c.recordDecision, exact: true })
      .click()
    await expect(page.getByRole('alert')).toHaveText(c.conflict)
    await page.getByLabel(c.reason, { exact: true }).fill('Changed reason')
    await page
      .getByRole('button', { name: c.recordDecision, exact: true })
      .click()
    await expect(page.getByRole('alert')).toHaveText(c.denied)
    await expect(page.getByLabel(c.reason, { exact: true })).toHaveValue(
      'Changed reason',
    )
    expect(bodies[0].requestId).not.toBe(bodies[1].requestId)
    expect(bodies[1].reason).toBe('Changed reason')
  })
  test(`C9d revoked detail and initial outage have no false success ${lang}`, async ({
    page,
  }) => {
    const { changeSets: c } = await fixture(page, lang, 'C9D', 'revoked')
    await expect(
      page.getByRole('button', { name: c.recordDecision, exact: true }),
    ).toHaveCount(0)
    await expect(page.getByText(c.denied, { exact: true })).toBeVisible()
    await fixture(page, lang, 'C9D', 'unavailable')
    await expect(page.getByRole('alert')).toHaveText(c.unavailable)
    await expect(
      page.getByRole('button', { name: c.submitVersion, exact: true }),
    ).toHaveCount(0)
    await expect(page.getByText(c.noVersions, { exact: true })).toHaveCount(0)
  })
  test(`C9d admin grant replay and revoke bind expected revision and identity ${lang}`, async ({
    page,
  }) => {
    const { approverAccess: c } = await fixture(page, lang, 'C9D_APPROVERS')
    const bodies: Record<string, unknown>[] = []
    await page.route('**/api/admin/accounts/*/approvers', (route) => {
      const body = route.request().postDataJSON()
      bodies.push(body)
      expect(body).toEqual({
        profileId: clientId,
        action: bodies.length <= 2 ? 'grant' : 'revoke',
        reason: bodies.length <= 2 ? 'Grant reason' : 'Revoke reason',
        expectedRevision: bodies.length <= 2 ? 0 : 1,
        requestId: expect.any(String),
      })
      return route.fulfill(
        bodies.length === 1
          ? { status: 503, json: { error: 'APPROVAL_UNAVAILABLE' } }
          : {
              status: 200,
              json: {
                id: bodies.length === 2 ? 'event-grant' : 'event-revoke',
                profileId: clientId,
                action: body.action,
                previousRevision: body.expectedRevision,
                newRevision: Number(body.expectedRevision) + 1,
                administrator: {
                  profileId: clientId,
                  displayName: 'Admin',
                  role: 'platform_admin',
                },
                reason: body.reason,
                createdAt: '2026-09-07T00:00:00Z',
              },
            },
      )
    })
    const reason = page.getByLabel(c.reason, { exact: true })
    await reason.fill('Grant reason')
    await page.getByRole('button', { name: c.saveAccess, exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText(c.unavailable)
    await expect(reason).toBeFocused()
    await expect(reason).toHaveValue('Grant reason')
    await reason.fill('  Grant reason  ')
    await page.getByRole('button', { name: c.saveAccess, exact: true }).click()
    await expect(page.getByRole('status')).toHaveText(c.accessRecorded)
    expect(bodies[0]).toEqual(bodies[1])
    await expect(page.getByText('Grant reason', { exact: true })).toHaveCount(1)
    await page.getByLabel(c.action, { exact: true }).selectOption('revoke')
    await reason.fill('Revoke reason')
    await page.getByRole('button', { name: c.saveAccess, exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByText('Revoke reason', { exact: true })).toBeVisible()
    expect(bodies[2].requestId).not.toBe(bodies[1].requestId)
    expect(bodies).toHaveLength(3)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })
  test(`C9d admin independent cursors, conflict and unavailable permission lookup ${lang}`, async ({
    page,
  }) => {
    const { approverAccess: c } = await fixture(page, lang, 'C9D_APPROVERS')
    const reads: string[] = []
    const bodies: Record<string, unknown>[] = []
    await page.route('**/api/admin/accounts/*/approvers?*', (route) => {
      const q = new URL(route.request().url()).searchParams
      reads.push(q.toString())
      return route.fulfill({
        json: {
          ...access,
          members: q.has('memberCursor')
            ? [
                {
                  ...access.members[0],
                  profileId: '77777777-7777-4777-8777-777777777777',
                  displayName: 'Second member',
                },
              ]
            : access.members,
          events: [],
          nextMemberCursor: q.has('memberCursor') ? null : clientId,
          nextEventCursor: q.has('eventCursor') ? null : 'opaque-event-cursor',
        },
      })
    })
    await page.getByRole('button', { name: c.reload, exact: true }).click()
    await page.getByRole('button', { name: c.moreMembers, exact: true }).click()
    await page.getByRole('button', { name: c.moreEvents, exact: true }).click()
    expect(reads).toEqual([
      '',
      'memberCursor=' + clientId,
      'memberCursor=' + clientId + '&eventCursor=opaque-event-cursor',
    ])
    await expect(page.getByText(/Second member —/)).toBeVisible()
    await page.route('**/api/admin/accounts/*/approvers', (route) => {
      bodies.push(route.request().postDataJSON())
      expect(route.request().postDataJSON()).toMatchObject({
        profileId: clientId,
        expectedRevision: 0,
        reason: 'Keep on conflict',
      })
      return route.fulfill({
        status: 409,
        json: { error: 'APPROVAL_CONFLICT' },
      })
    })
    await page.getByLabel(c.reason, { exact: true }).fill('Keep on conflict')
    await page.getByRole('button', { name: c.saveAccess, exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText(c.conflict)
    await expect(page.getByLabel(c.reason, { exact: true })).toHaveValue(
      'Keep on conflict',
    )
    await page.route('**/api/admin/accounts/*/approvers?*', (route) =>
      route.fulfill({ status: 503, json: { error: 'APPROVAL_UNAVAILABLE' } }),
    )
    await page.getByRole('button', { name: c.reload, exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText(c.unavailable)
    await expect(page.getByLabel(c.reason, { exact: true })).toHaveValue(
      'Keep on conflict',
    )
    const save = page.getByRole('button', { name: c.saveAccess, exact: true })
    await expect(save).toBeDisabled()
    await expect(page.getByLabel(c.member, { exact: true })).toHaveValue(
      clientId,
    )
    await expect(page.getByLabel(c.action, { exact: true })).toHaveValue(
      'grant',
    )
    for (const failure of ['network', 'json'] as const) {
      await page.route('**/api/admin/accounts/*/approvers?*', (route) =>
        route.fulfill({ json: access }),
      )
      await page.getByRole('button', { name: c.reload, exact: true }).click()
      await expect(save).toBeEnabled()
      await page.route('**/api/admin/accounts/*/approvers?*', (route) =>
        failure === 'network'
          ? route.abort('failed')
          : route.fulfill({ status: 200, body: '{invalid json' }),
      )
      await page.getByRole('button', { name: c.reload, exact: true }).click()
      await expect(page.getByRole('alert')).toHaveText(c.unavailable)
      await expect(save).toBeDisabled()
      await expect(page.getByLabel(c.reason, { exact: true })).toHaveValue(
        'Keep on conflict',
      )
      await expect(page.getByLabel(c.member, { exact: true })).toHaveValue(
        clientId,
      )
      await expect(page.getByLabel(c.action, { exact: true })).toHaveValue(
        'grant',
      )
    }
    expect(bodies).toHaveLength(1)
    await page.route('**/api/admin/accounts/*/approvers?*', (route) =>
      route.fulfill({ json: access }),
    )
    await page.getByRole('button', { name: c.reload, exact: true }).click()
    await expect(save).toBeEnabled()
    await save.click()
    await expect(page.getByRole('alert')).toHaveText(c.conflict)
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toEqual(bodies[0])
  })
  test(`C9d admin initial outage cannot grant or show zero approvers ${lang}`, async ({
    page,
  }) => {
    const { approverAccess: c } = await fixture(
      page,
      lang,
      'C9D_APPROVERS',
      'unavailable',
    )
    await expect(page.getByRole('alert')).toHaveText(c.unavailable)
    await expect(page.getByText(c.noApprovers, { exact: true })).toHaveCount(0)
    await expect(page.getByLabel(c.reason, { exact: true })).toHaveCount(0)
  })
  test(`C9d draft version link protects unsaved text and uses current locale ${lang}`, async ({
    page,
  }) => {
    const { opportunities: c } = await fixture(page, lang, 'C9C_DRAFT')
    const link = page.getByRole('link', { name: c.versionHistory, exact: true })
    await expect(link).toHaveAttribute(
      'href',
      `/${lang}/dashboard/${clientId}/work-items/${draft.id}/versions`,
    )
    await page.getByLabel(c.titleField, { exact: true }).fill('Unsaved title')
    await expect(link).toHaveCount(0)
    await expect(
      page.getByText(c.saveBeforeVersions, { exact: true }),
    ).toBeVisible()
    await page.route('**/api/clients/*/work-items/*', (route) => {
      expect(route.request().postDataJSON()).toEqual({
        title: 'Unsaved title',
        action: draft.action,
        notes: draft.notes,
        expectedRevision: draft.revision,
      })
      return route.fulfill({
        json: {
          item: {
            ...draft,
            title: 'Unsaved title',
            revision: draft.revision + 1,
          },
        },
      })
    })
    await page.getByRole('button', { name: c.saveChanges, exact: true }).click()
    await expect(link).toHaveAttribute(
      'href',
      `/${lang}/dashboard/${clientId}/work-items/${draft.id}/versions`,
    )
    await expect(page.getByLabel(c.titleField, { exact: true })).toHaveValue(
      'Unsaved title',
    )
  })
}

for (const lang of ['en', 'zh-HK'])
  test(`C9d conflict refresh retains reason while capabilities change ${lang}`, async ({
    page,
  }) => {
    const { changeSets: c } = await fixture(page, lang)
    await page.route('**/versions/*/decision', (route) =>
      route.fulfill({ status: 409, json: { error: 'CHANGE_SET_CONFLICT' } }),
    )
    await page.route('**/work-items/*/versions', (route) =>
      route.fulfill({
        json: {
          ...initial,
          versions: [{ ...version, capabilities: { canDecide: false } }],
        },
      }),
    )
    await page.getByLabel(c.reason, { exact: true }).fill('Retained review')
    await page
      .getByRole('button', { name: c.recordDecision, exact: true })
      .click()
    await expect(page.getByRole('alert')).toHaveText(c.conflict)
    await page
      .getByRole('button', { name: c.reloadHistory, exact: true })
      .click()
    await expect(page.getByLabel(c.reason, { exact: true })).toHaveValue(
      'Retained review',
    )
    await expect(
      page.getByRole('button', { name: c.recordDecision, exact: true }),
    ).toBeDisabled()
  })

for (const lang of ['en', 'zh-HK']) {
  test(`C9d deferred history cannot undo a confirmed decision ${lang}`, async ({
    page,
  }) => {
    const { changeSets: c } = await fixture(page, lang)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let reads = 0,
      writes = 0
    const reason = 'Confirmed independent review'
    await page.route('**/work-items/*/versions', async (route) => {
      reads++
      await gate
      await route.fulfill({ json: initial })
    })
    await page.route('**/versions/*/decision', (route) => {
      writes++
      expect(route.request().postDataJSON()).toEqual({
        decision: 'approved',
        reason,
        requestId: expect.any(String),
      })
      return route.fulfill({
        status: 201,
        json: {
          version: {
            ...version,
            decision: {
              decision: 'approved',
              reason,
              decidedBy: {
                profileId: clientId,
                displayName: 'Independent reviewer',
                role: 'account_approver',
              },
              decidedAt: '2026-09-07T00:00:00Z',
            },
            capabilities: { canDecide: false },
          },
        },
      })
    })
    await page
      .getByRole('button', { name: c.reloadHistory, exact: true })
      .click()
    await expect.poll(() => reads).toBe(1)
    try {
      await page.getByLabel(c.reason, { exact: true }).fill(reason)
      await page
        .getByRole('button', { name: c.recordDecision, exact: true })
        .click()
      await expect(page.getByText(reason, { exact: true })).toBeVisible()
    } finally {
      release()
    }
    await expect(page.getByRole('main')).toHaveAttribute('aria-busy', 'false')
    await expect(page.getByRole('status')).toHaveText(c.decisionRecorded)
    await expect(page.getByText(reason, { exact: true })).toBeVisible()
    await expect(
      page.getByRole('button', { name: c.recordDecision, exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', {
        name: new RegExp(
          (lang === 'en' ? 'Version 1' : '版本 1') + ' · ' + c.approved,
        ),
      }),
    ).toBeVisible()
    expect(writes).toBe(1)
  })
  test(`C9d deferred selection retains a reason typed during the read ${lang}`, async ({
    page,
  }) => {
    const { changeSets: c } = await fixture(page, lang, 'C9D', 'selection')
    const older = {
      ...version,
      id: '66666666-6666-4666-8666-666666666666',
      title: 'Older immutable title',
      capabilities: { canDecide: false },
    }
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let reads = 0
    await page.route('**/versions/' + older.id, async (route) => {
      reads++
      await gate
      await route.fulfill({ json: { version: older } })
    })
    await page
      .getByRole('button', {
        name: new RegExp((lang === 'en' ? 'Version 1' : '版本 1') + ' ·'),
      })
      .click()
    await expect.poll(() => reads).toBe(1)
    try {
      await page
        .getByLabel(c.reason, { exact: true })
        .fill('Typed while older version loads')
    } finally {
      release()
    }
    await expect(page.getByRole('main')).toHaveAttribute('aria-busy', 'false')
    await expect(page.getByLabel(c.reason, { exact: true })).toHaveValue(
      'Typed while older version loads',
    )
    await expect(page.getByText(version.title, { exact: true })).toBeVisible()
    await expect(page.getByText(older.title, { exact: true })).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: c.recordDecision, exact: true }),
    ).toBeEnabled()
  })
}

async function reviewProps(page: Page): Promise<VersionWorkspaceProps> {
  return JSON.parse((await page.locator('#fixture-props').textContent())!).props
}
function decided(saved: VersionDetail, decision: 'approved' | 'changes_requested', reason: string): VersionDetail {
  return { ...saved, decision: { decision, reason, decidedBy: { profileId: '88888888-8888-4888-8888-888888888888', displayName: 'Independent reviewer', role: 'account_approver' }, decidedAt: '2026-09-07T00:00:00.123456Z' }, capabilities: { canDecide: false } }
}
for (const lang of ['en','zh-HK']) {
  test(`SME requires explicit choice, preserves choice-only edits and discards to unset ${lang}`, async ({ page }) => {
    const { changeSets: c } = await fixture(page, lang, 'C9D', 'sme')
    let writes = 0
    await page.route('**/versions/*/decision', route => { writes++; return route.fulfill({ status: 503, json: {} }) })
    const choice = page.getByLabel(c.decision, { exact: true }), record = page.getByRole('button', { name: c.recordDecision, exact: true })
    await expect(choice).toHaveValue('')
    await expect(record).toBeDisabled()
    await choice.locator('..').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await expect(page.getByRole('alert')).toHaveText(c.sme.chooseDecision)
    await expect(choice).toBeFocused()
    await choice.selectOption('approved')
    await expect(page.getByText(c.sme.finishReview, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp((lang === 'en' ? 'Version 1' : '版本 1') + ' ·') })).toBeDisabled()
    page.once('dialog', async dialog => { expect(dialog.message()).toBe(c.sme.unsaved); await dialog.dismiss() })
    await page.getByRole('link', { name: c.backToDrafts, exact: true }).click()
    await expect(page).toHaveURL(`https://review.fixture/${lang}`)
    await expect(choice).toHaveValue('approved')
    await page.getByRole('button', { name: c.sme.discardReview, exact: true }).click()
    await expect(choice).toHaveValue('')
    await expect(record).toBeDisabled()
    await expect(page.getByRole('button', { name: new RegExp((lang === 'en' ? 'Version 1' : '版本 1') + ' ·') })).toBeEnabled()
    expect(writes).toBe(0)
  })
  for (const failure of ['403','409','evidence-changed','503','network','json','foreign-item','foreign-id','hash','revision','number','schema','missing-decision','decision','reason']) {
    test(`SME ${failure} retains choice, reason and exact normalized retry identity ${lang}`, async ({ page }) => {
      const { changeSets: c } = await fixture(page, lang, 'C9D', ['hash','revision','schema'].includes(failure) ? 'smeV2' : 'sme')
      const saved = (await reviewProps(page)).initialVersion!, bodies: Record<string, unknown>[] = []
      await page.route('**/versions/*/decision', route => {
        const body = route.request().postDataJSON(); bodies.push(body)
        if (bodies.length > 1) return route.fulfill({ status: 503, json: {} })
        if (failure === 'network') return route.abort('failed')
        if (failure === 'json') return route.fulfill({ status: 200, contentType: 'application/json', body: '{' })
        if (['403','409','503','evidence-changed'].includes(failure)) return route.fulfill({ status: failure === 'evidence-changed' ? 409 : Number(failure), json: { error: failure === 'evidence-changed' ? 'EVIDENCE_CHANGED' : 'CHANGE_SET_UNAVAILABLE' } })
        const ack = decided(saved, 'approved', 'Café')
        const change = failure === 'foreign-item' ? { workItemId: clientId } : failure === 'foreign-id' ? { id: clientId } : failure === 'hash' ? { contentHash: 'f'.repeat(64) } : failure === 'revision' ? { draftRevision: saved.draftRevision + 1 } : failure === 'number' ? { versionNumber: saved.versionNumber + 1 } : failure === 'schema' ? { schemaVersion: saved.schemaVersion === 1 ? 2 : 1 } : failure === 'missing-decision' ? { decision: null } : { decision: { ...ack.decision!, ...(failure === 'decision' ? { decision: 'changes_requested' } : { reason: 'Different reason' }) } }
        return route.fulfill({ json: { version: { ...ack, ...change } } })
      })
      const choice = page.getByLabel(c.decision, { exact: true }), reason = page.getByLabel(c.reason, { exact: true }), record = page.getByRole('button', { name: c.recordDecision, exact: true })
      await choice.selectOption('approved'); await reason.fill('  Cafe\u0301  '); await record.click()
      await expect(page.getByRole('alert')).toHaveText(failure === '403' ? c.denied : ['409','evidence-changed'].includes(failure) ? c.conflict : c.unavailable)
      await expect(choice).toHaveValue('approved'); await expect(reason).toHaveValue('  Cafe\u0301  '); await expect(reason).toBeFocused()
      await reason.fill('Café'); await record.click()
      await expect(page.getByRole('alert')).toHaveText(c.unavailable)
      expect(bodies).toHaveLength(2); expect(bodies[0]).toEqual(bodies[1]); expect(bodies[0]).toEqual({ decision: 'approved', reason: 'Café', requestId: expect.any(String) })
      await choice.selectOption('changes_requested'); await record.click()
      await expect(page.getByRole('alert')).toHaveText(c.unavailable)
      expect(bodies).toHaveLength(3); expect(bodies[2].requestId).not.toBe(bodies[1].requestId)
      await expect(choice).toHaveValue('changes_requested'); await expect(reason).toHaveValue('Café')
      await page.getByRole('button', { name: c.sme.discardReview, exact: true }).click()
      await expect(choice).toHaveValue('')
    })
  }
  test(`SME decision stays live during history and outranks the deferred pending response ${lang}`, async ({ page }) => {
    const { changeSets: c } = await fixture(page, lang, 'C9D', 'sme')
    let release!: () => void, reads = 0, writes = 0
    const gate = new Promise<void>(resolve => { release = resolve })
    await page.route('**/work-items/*/versions', async route => { reads++; await gate; return route.fulfill({ json: initial }) })
    await page.route('**/versions/*/decision', route => { writes++; return route.fulfill({ json: { version: decided(version, 'approved', 'Intentional independent review') } }) })
    await page.getByRole('button', { name: c.reloadHistory, exact: true }).click()
    await expect.poll(() => reads).toBe(1)
    try {
      await page.getByLabel(c.decision, { exact: true }).selectOption('approved')
      await page.getByLabel(c.reason, { exact: true }).fill('Intentional independent review')
      await page.getByRole('button', { name: c.recordDecision, exact: true }).click()
      await expect(page.getByText('Intentional independent review', { exact: true })).toBeVisible()
    } finally { release() }
    await expect(page.getByRole('main')).toHaveAttribute('aria-busy', 'false')
    await expect(page.getByRole('status')).toHaveText(c.decisionRecorded)
    await expect(page.getByRole('button', { name: c.recordDecision, exact: true })).toHaveCount(0)
    expect(writes).toBe(1)
  })
  test(`SME capability refresh keeps choice and reason mounted and disables only the retained review ${lang}`, async ({ page }) => {
    const { changeSets: c } = await fixture(page, lang, 'C9D', 'sme')
    let writes = 0
    await page.route('**/versions/*/decision', route => { writes++; return route.abort() })
    await page.route('**/work-items/*/versions', route => route.fulfill({ json: { ...initial, versions: [{ ...version, capabilities: { canDecide: false } }] } }))
    const choice = page.getByLabel(c.decision, { exact: true }), reason = page.getByLabel(c.reason, { exact: true })
    await choice.selectOption('changes_requested'); await reason.fill('Retain this explicit choice')
    await page.getByRole('button', { name: c.reloadHistory, exact: true }).click()
    await expect(choice).toHaveValue('changes_requested'); await expect(choice).toBeDisabled()
    await expect(reason).toHaveValue('Retain this explicit choice'); await expect(reason).toHaveAttribute('readonly', '')
    await expect(page.getByRole('button', { name: c.recordDecision, exact: true })).toBeDisabled()
    await page.getByRole('button', { name: c.sme.discardReview, exact: true }).click()
    await expect(choice).toHaveCount(0)
    expect(writes).toBe(0)
  })
  for (const decision of ['approved','changes_requested'] as const) for (const entry of ['initial','selected']) {
    test(`SME ${decision} terminal ${entry} detail survives stale pending history ${lang}`, async ({ page }) => {
      const { changeSets: c } = await fixture(page, lang, 'C9D', entry === 'selected' ? 'smeHistorical' : decision === 'approved' ? 'smeTerminal' : 'smeChanges')
      const props = await reviewProps(page), list = props.initial!
      let writes = 0
      await page.route('**/versions/*/decision', route => { writes++; return route.abort() })
      await page.route('**/work-items/*/versions', route => route.fulfill({ json: list }))
      if (entry === 'selected') {
        const latest = list.versions.find(row => row.id === list.latestVersionId)!
        if (version.schemaVersion !== 1 || latest.schemaVersion !== 1) throw Error('Expected V1 historical fixture')
        const terminal = decided({ ...version, ...latest, schemaVersion: 1 }, decision, 'Fresh terminal detail')
        await page.route('**/versions/' + latest.id, route => route.fulfill({ json: { version: terminal } }))
        await page.getByRole('button', { name: new RegExp((lang === 'en' ? 'Version 2' : '版本 2') + ' ·') }).click()
      }
      await expect(page.getByRole('heading', { name: decision === 'approved' ? c.sme.approved : c.sme.revise, exact: true })).toBeVisible()
      await expect(page.getByText('Fresh terminal detail', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: c.reloadHistory, exact: true }).click()
      await expect(page.getByRole('alert')).toHaveText(c.unavailable)
      await expect(page.getByText('Fresh terminal detail', { exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: decision === 'approved' ? c.sme.approved : c.sme.revise, exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: c.recordDecision, exact: true })).toHaveCount(0)
      if (decision === 'changes_requested') await expect(page.getByRole('link', { name: c.sme.backToThisDraft, exact: true })).toHaveAttribute('href', `/${lang}/dashboard/${clientId}/opportunities?draft=${draft.id}`)
      expect(writes).toBe(0)
    })
  }
  test(`SME new saved edits freeze only after explicit acknowledgement and independent latest reload ${lang}`, async ({ page }) => {
    const { changeSets: c } = await fixture(page, lang, 'C9D', 'smeNewer')
    const props = await reviewProps(page)
    const submitted: VersionDetail = { ...version, id: '66666666-6666-4666-8666-666666666666', versionNumber: 2, draftRevision: 2, title: props.initialDraft!.title, capabilities: { canDecide: false } }
    let release!: () => void, posts = 0, reads = 0
    const gate = new Promise<void>(resolve => { release = resolve })
    await page.route('**/work-items/*/versions', async route => {
      if (route.request().method() === 'GET') { reads++; return route.fulfill({ json: { versions: [version, submitted], latestVersionId: submitted.id, nextCursor: null } }) }
      posts++; expect(route.request().postDataJSON()).toEqual({ expectedRevision: 2 }); await gate
      return route.fulfill({ status: 201, json: { version: submitted } })
    })
    const freeze = page.getByRole('button', { name: c.submitVersion, exact: true })
    await expect(page.getByRole('heading', { name: c.sme.prepare, exact: true })).toBeVisible()
    await expect(page.getByText(c.sme.newerDraft, { exact: true })).toBeVisible()
    await expect(freeze).toHaveClass(/bg-primary/)
    expect(posts).toBe(0)
    await freeze.click(); await expect.poll(() => posts).toBe(1)
    try { await expect(freeze).toBeDisabled(); await expect(page.getByRole('status')).not.toHaveText(c.versionSubmitted) } finally { release() }
    await expect(page.getByRole('status')).toHaveText(c.versionSubmitted)
    await expect(page.getByRole('heading', { name: c.sme.wait, exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: submitted.title, exact: true })).toBeVisible()
    await expect(freeze).toHaveCount(0); expect(posts).toBe(1); expect(reads).toBe(1)
    await expect(page.getByRole('button', { name: c.recordDecision, exact: true })).toHaveCount(0)
  })
  test(`SME unavailable history never enables freezing while confirmed empty history does ${lang}`, async ({ page }) => {
    const { changeSets: c } = await fixture(page, lang, 'C9D', 'smeUnavailable')
    let posts = 0
    await page.route('**/work-items/*/versions', route => {
      if (route.request().method() !== 'GET') { posts++; return route.abort() }
      return route.fulfill({ json: { versions: [], latestVersionId: null, nextCursor: null } })
    })
    await expect(page.getByRole('button', { name: c.submitVersion, exact: true })).toHaveCount(0)
    await expect(page.getByText(c.noVersions, { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: c.reloadHistory, exact: true }).click()
    await expect(page.getByRole('heading', { name: c.sme.prepare, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: c.submitVersion, exact: true })).toBeEnabled()
    await expect(page.getByText(c.noVersions, { exact: true })).toBeVisible()
    expect(posts).toBe(0)
  })
  test(`SME historical inspection stays read-only through refresh until latest is explicitly opened ${lang}`, async ({ page }) => {
    const { changeSets: c } = await fixture(page, lang, 'C9D', 'smeHistorical')
    const props = await reviewProps(page), list = props.initial!, latest = list.versions.find(row => row.id === list.latestVersionId)!
    let details = 0, writes = 0
    await page.route('**/work-items/*/versions', route => { if (route.request().method() !== 'GET') writes++; return route.fulfill({ json: list }) })
    await page.route('**/versions/' + latest.id, route => { details++; return route.fulfill({ json: { version: { ...version, ...latest } } }) })
    await expect(page.getByRole('heading', { name: c.sme.historical, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: c.recordDecision, exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: c.reloadHistory, exact: true }).click()
    await expect(page.getByRole('main')).toHaveAttribute('aria-busy', 'false')
    await expect(page.getByRole('heading', { name: c.sme.historical, exact: true })).toBeVisible()
    expect(details).toBe(0)
    await page.getByRole('button', { name: c.sme.review + ' · ' + c.versionNumber.replace('{number}', '2'), exact: true }).click()
    await expect(page.getByRole('heading', { name: c.sme.review, exact: true })).toBeVisible()
    await expect(page.getByLabel(c.decision, { exact: true })).toHaveValue('')
    expect(details).toBe(1); expect(writes).toBe(0)
  })
  for (const operation of ['decision','history'] as const) test(`SME old ${operation} completion cannot affect a new brand scope with the same version identity ${lang}`, async ({ page }) => {
    const { changeSets: c } = await fixture(page, lang, 'C9D', 'sme')
    const props = await reviewProps(page), nextBrand = '99999999-9999-4999-8999-999999999999'
    let release!: () => void, requests = 0
    const gate = new Promise<void>(resolve => { release = resolve })
    const path = operation === 'decision' ? '**/versions/*/decision' : '**/work-items/*/versions'
    await page.route(path, async route => {
      requests++; await gate
      return route.fulfill({ json: operation === 'decision' ? { version: decided(version, 'approved', 'Old brand decision') } : initial })
    })
    if (operation === 'decision') {
      await page.getByLabel(c.decision, { exact: true }).selectOption('approved')
      await page.getByLabel(c.reason, { exact: true }).fill('Old brand decision')
      await page.getByRole('button', { name: c.recordDecision, exact: true }).click()
    } else await page.getByRole('button', { name: c.reloadHistory, exact: true }).click()
    await expect.poll(() => requests).toBe(1)
    const oldResponse = page.waitForResponse(response => response.url().includes('/' + clientId + '/') && response.url().endsWith(operation === 'decision' ? '/decision' : '/versions'))
    const next = { ...props, clientId: nextBrand, initialDraft: { ...props.initialDraft!, clientId: nextBrand } }
    await page.evaluate(value => window.dispatchEvent(new CustomEvent('fixture-review-scope', { detail: value })), next)
    try {
      await expect(page.getByRole('link', { name: c.backToDrafts, exact: true })).toHaveAttribute('href', `/${lang}/dashboard/${nextBrand}/opportunities`)
      await expect(page.getByLabel(c.decision, { exact: true })).toHaveValue('')
      await page.getByLabel(c.decision, { exact: true }).selectOption('changes_requested')
      await page.getByLabel(c.reason, { exact: true }).fill('New scope edits')
    } finally { release() }
    await oldResponse
    await expect(page.getByRole('main')).toHaveAttribute('aria-busy', 'false')
    await expect(page.getByLabel(c.decision, { exact: true })).toHaveValue('changes_requested')
    await expect(page.getByLabel(c.reason, { exact: true })).toHaveValue('New scope edits')
    await expect(page.getByRole('status')).not.toHaveText(c.decisionRecorded)
    await expect(page.getByText('Old brand decision', { exact: true })).toHaveCount(0)
    expect(requests).toBe(1)
  })
  for (const width of [320,390,768,1440]) for (const theme of ['light','dark']) {
    test(`SME genuine V2 keeps every frozen source ordered and keyboard accessible ${lang} ${width} ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      const { changeSets: c, opportunities: o } = await fixture(page, lang, 'C9D', 'smeV2')
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value === 'dark'), theme)
      const saved = (await reviewProps(page)).initialVersion!
      if (saved.schemaVersion !== 2) throw Error('Expected actual frozen V2 fixture')
      const sources = page.getByRole('region', { name: new RegExp(c.sme.sourceNumber.replace('{number}', '\\d+')) })
      await expect(sources).toHaveCount(3)
      await expect(sources.nth(0)).toContainText('Saved scan <script>source</script>')
      await expect(sources.nth(1)).toContainText('Original title'); await expect(sources.nth(2)).toContainText('Original title')
      await expect(page.getByText(o.pulseUnknowns, { exact: true })).toHaveCount(2)
      for (let index = 0; index < 3; index++) {
        const summary = sources.nth(index).locator('summary').filter({ hasText: c.sme.frozenTechnical })
        await summary.focus(); await page.keyboard.press('Enter')
        await expect(summary.locator('..')).toHaveJSProperty('open', true)
        expect(JSON.parse((await sources.nth(index).locator('pre').textContent())!)).toEqual(saved.evidenceSnapshots[index])
        expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      }
      await expect(page.getByLabel(c.decision, { exact: true })).toHaveValue('')
      await expect(page.getByRole('button', { name: c.recordDecision, exact: true })).toBeDisabled()
      expect(await page.locator('button.bg-primary').count()).toBe(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      if ((lang === 'en' && width === 1440 && theme === 'light') || (lang === 'zh-HK' && width === 390 && theme === 'dark')) await page.screenshot({ path: `artifacts/ux/sme-review-${lang}-${width}-${theme}-${testInfo.project.name}.png`, fullPage: true })
    })
  }
}
