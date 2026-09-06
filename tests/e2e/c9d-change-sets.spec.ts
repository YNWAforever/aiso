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
  await page.goto(`https://review.fixture/${lang}`)
  await page.waitForFunction(() =>
    Boolean((window as Window & { c9cFixtureReady?: boolean }).c9cFixtureReady),
  )
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
