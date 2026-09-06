import { test, expect, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'
import type { DeliveryEvent, DeliveryPage } from '../../lib/delivery/types'
import type { VersionWorkspaceProps } from '../../components/change-sets/VersionWorkspace'
const errors = new WeakMap<Page, string[]>()
async function fixture(page: Page, lang: string, variant = 'default') {
  const dir = process.env.C9E_HTML_DIR!, css = process.env.C9E_CSS_PATH!
  if (!dir || !css) throw Error('C9E fixtures required')
  const props = JSON.parse(readFileSync(dir + '/' + lang + '-data.json', 'utf8')) as VersionWorkspaceProps
  const version = props.initialVersion!, c = (lang === 'en' ? en : zh).delivery
  const context = { events: [] as DeliveryEvent[], active: null as string | null, reads: 0, posts: [] as Record<string, unknown>[],
    reason: (variant === 'pending' ? 'not_approved' : null) as DeliveryPage['capabilities']['attestReason'],
    readHook: null as ((route: Route) => Promise<void>) | null,
    postHook: null as ((route: Route) => Promise<void>) | null,
    versionHook: null as ((route: Route) => Promise<void>) | null }
  const history = (): DeliveryPage => ({ events: context.events, activeAttestationId: context.active, nextCursor: null,
    capabilities: { canExport: context.reason !== 'not_approved', canAttest: context.reason === null && context.active === null,
      canWithdraw: context.active !== null, attestReason: context.reason ?? (context.active ? 'active_attestation' : null), withdrawReason: context.active ? null : 'no_active_attestation' } })
  const event = (body: Record<string, unknown>, withdrawal = false): DeliveryEvent => ({ schemaVersion: 1, eventId: randomUUID(), versionId: version.id,
    contentHash: version.contentHash, actor: { profileId: '123e4567-e89b-42d3-a456-426614174001', displayName: null, role: 'account_member' }, recordedAt: '2026-09-07T01:00:00.123456Z',
    ...(withdrawal ? { kind: 'withdraw' as const, targetAttestationId: context.active!, reason: String(body.reason) } : { kind: 'attest' as const, destination: String(body.destination), deliveredAt: String(body.deliveredAt), note: String(body.note) }) })
  const commit = async (route: Route) => {
    const body = route.request().postDataJSON(), next = event(body, route.request().url().endsWith('/withdraw'))
    context.events = [next, ...context.events]; context.active = next.kind === 'attest' ? next.eventId : null
    await route.fulfill({ status: 201, json: { event: next } })
  }
  const pageErrors: string[] = []; errors.set(page, pageErrors); page.on('pageerror', e => pageErrors.push(e.message))
  await page.route('**/*', route => route.abort())
  await page.route('**/api/clients/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/export')) {
      const artifact = JSON.parse(readFileSync(dir + '/export-' + url.searchParams.get('format') + '.json', 'utf8'))
      return route.fulfill({ body: artifact.body, headers: { 'Content-Type': artifact.contentType, 'Content-Disposition': `attachment; filename="${artifact.filename}"`, 'X-Aiso-Export-Sha256': artifact.exportHash } })
    }
    if (url.pathname.endsWith('/delivery') && route.request().method() === 'GET') {
      context.reads++; return context.readHook ? context.readHook(route) : route.fulfill({ json: history() })
    }
    if (url.pathname.includes('/delivery') && route.request().method() === 'POST') {
      context.posts.push(route.request().postDataJSON()); return context.postHook ? context.postHook(route) : commit(route)
    }
    if (context.versionHook) return context.versionHook(route)
    return route.fulfill({ json: { version } })
  })
  await page.route(`https://delivery.fixture/${lang}`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Delivery fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${readFileSync(css, 'utf8')}</style></head><body>${readFileSync(dir + '/' + lang + '-' + variant + '.html', 'utf8')}<script>${readFileSync(dir + '/fixture.js', 'utf8')}</script></body></html>` }))
  await page.goto(`https://delivery.fixture/${lang}`)
  await page.waitForFunction(() => Boolean((window as Window & { c9cFixtureReady?: boolean }).c9cFixtureReady))
  const section = page.getByRole('region', { name: c.title, exact: true })
  await expect(section).toHaveAttribute('aria-busy', 'false')
  const fill = async (destination = ' Site ', time = '2026-09-07T00:00:00') => {
    await section.getByLabel(c.destination, { exact: true }).fill(destination)
    await section.getByLabel(c.timeUtc, { exact: true }).fill(time.endsWith(':00') ? time.slice(0, -3) : time)
    await section.getByLabel(c.note, { exact: true }).fill(' e\u0301\n交付 ')
  }
  return { c, props, version, section, context, history, commit, event, fill, dir }
}
test.afterEach(({ page }) => expect(errors.get(page) ?? []).toEqual([]))
for (const lang of ['en', 'zh-HK']) {
  test(`C9e actual downloads preserve bytes and never attest ${lang}`, async ({ page }) => {
    const { c, section, context, fill, dir, version } = await fixture(page, lang)
    await fill()
    for (const format of ['json', 'text']) {
      const [download] = await Promise.all([page.waitForEvent('download'), section.getByRole('button', { name: format === 'json' ? c.exportJson : c.exportText, exact: true }).click()])
      expect(download.suggestedFilename()).toBe(`delivery-${version.id}.${format === 'json' ? 'json' : 'txt'}`)
      const artifact = JSON.parse(readFileSync(dir + '/export-' + format + '.json', 'utf8'))
      expect(readFileSync((await download.path())!, 'utf8')).toBe(artifact.body)
    }
    expect(context.posts).toHaveLength(0)
    await expect(section.getByLabel(c.destination, { exact: true })).toHaveValue(' Site ')
    await expect(section.getByText(c.noActive, { exact: true })).toBeVisible()
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath('delivery-workspace.png'), fullPage: true })
  })
  test(`C9e attestation withdrawal and correction are distinct audited events ${lang}`, async ({ page }) => {
    const { c, section, context, fill } = await fixture(page, lang)
    await fill('<script>alert(1)</script>')
    await section.getByRole('button', { name: c.record, exact: true }).click()
    await expect(section.getByText(c.recorded, { exact: true })).toBeFocused()
    expect(context.posts[0]).toMatchObject({ destination: '<script>alert(1)</script>', deliveredAt: '2026-09-07T00:00:00.000Z', note: 'é\n交付', requestId: expect.any(String) })
    await expect(section.getByText('<script>alert(1)</script>', { exact: true })).toBeVisible()
    await expect(section.getByText(c.unknownActor, { exact: true })).toBeVisible()
    await expect(section.getByRole('link')).toHaveCount(0)
    await section.getByRole('button', { name: c.withdraw, exact: true }).click()
    await expect(section.getByLabel(c.withdrawReason, { exact: true })).toBeFocused()
    await section.getByLabel(c.withdrawReason, { exact: true }).fill('Correction')
    await section.getByRole('button', { name: c.confirmWithdraw, exact: true }).click()
    await expect(section.getByText(c.withdrawalRecorded, { exact: true })).toBeFocused()
    await fill('Correct destination')
    await section.getByRole('button', { name: c.record, exact: true }).click()
    await expect(section.getByText('Correct destination', { exact: true })).toBeVisible()
    expect(context.posts).toHaveLength(3)
    expect(new Set(context.posts.map(p => p.requestId)).size).toBe(3)
  })
  test(`C9e lost-response retry preserves normalized request identity ${lang}`, async ({ page }) => {
    const f = await fixture(page, lang), { c, section, context } = f
    context.postHook = route => context.posts.length === 1 ? route.abort() : f.commit(route)
    await f.fill(); await section.getByRole('button', { name: c.record, exact: true }).click()
    await expect(section.getByRole('alert')).toHaveText(c.unavailable)
    await expect(section.getByRole('button', { name: c.record, exact: true })).toBeDisabled()
    await section.getByRole('button', { name: c.refresh, exact: true }).click()
    await expect(section.getByRole('button', { name: c.record, exact: true })).toBeEnabled()
    await section.getByLabel(c.destination, { exact: true }).fill('Site')
    await section.getByRole('button', { name: c.record, exact: true }).click()
    await expect(section.getByText(c.recorded, { exact: true })).toBeVisible()
    expect(context.posts[1]).toEqual(context.posts[0])
  })
  for (const failure of ['503', 'network', 'malformed', '401', '403']) test(`C9e ${failure} read fails closed and preserves input for recovery ${lang}`, async ({ page }) => {
    const { c, section, context, fill } = await fixture(page, lang)
    await fill()
    context.readHook = route => failure === 'network' ? route.abort() : failure === 'malformed' ? route.fulfill({ contentType: 'application/json', body: '{' }) : route.fulfill({ status: Number(failure), json: { error: 'failure' } })
    await section.getByRole('button', { name: c.refresh, exact: true }).click()
    await expect(section.getByRole('alert')).toBeVisible()
    await expect(section.getByRole('button', { name: c.record, exact: true })).toBeDisabled()
    await expect(section.getByRole('button', { name: c.exportJson, exact: true })).toBeDisabled()
    await expect(section.getByLabel(c.note, { exact: true })).toHaveValue(' e\u0301\n交付 ')
    context.readHook = null
    await section.getByRole('button', { name: c.refresh, exact: true }).click()
    await expect(section.getByRole('button', { name: c.record, exact: true })).toBeEnabled()
  })
  test(`C9e pending approval refreshes delivery on the same selected version ${lang}`, async ({ page }) => {
    const { c, section, context, version } = await fixture(page, lang, 'pending'), review = (lang === 'en' ? en : zh).changeSets
    await expect(section.getByRole('button', { name: c.record, exact: true })).toBeDisabled()
    context.versionHook = route => { context.reason = null; return route.fulfill({ json: { version } }) }
    await page.getByLabel(review.reason, { exact: true }).fill('Reviewed')
    await page.getByRole('button', { name: review.recordDecision, exact: true }).click()
    await expect(section.getByRole('button', { name: c.record, exact: true })).toBeEnabled()
  })
  test(`C9e historical active state remains outside a bounded page ${lang}`, async ({ page }) => {
    const { c, section, context, history } = await fixture(page, lang)
    context.reason = 'superseded'; context.active = '11111111-1111-4111-8111-111111111111'
    context.readHook = route => route.fulfill({ json: { ...history(), events: [], nextCursor: 'next' } })
    await section.getByRole('button', { name: c.refresh, exact: true }).click()
    await expect(section.getByText(c.superseded, { exact: true })).toBeVisible()
    await expect(section.getByText(c.empty, { exact: true })).toHaveCount(0)
    await expect(section.getByRole('button', { name: c.exportJson, exact: true })).toBeEnabled()
    await expect(section.getByRole('button', { name: c.record, exact: true })).toBeDisabled()
    await expect(section.getByRole('button', { name: c.withdraw, exact: true })).toBeEnabled()
    await section.getByRole('button', { name: c.more, exact: true }).click()
    await expect(section).toHaveAttribute('aria-busy', 'false')
  })
  test(`C9e future before-approval and stale-hash errors retain input ${lang}`, async ({ page }) => {
    const { c, section, context, fill } = await fixture(page, lang)
    for (const [time, status] of [['2999-01-01T00:00:00', 422], ['2020-01-01T00:00:00', 422], ['2026-09-07T00:00:00', 409]] as const) {
      context.postHook = route => route.fulfill({ status, json: { error: status === 409 ? 'DELIVERY_CONFLICT' : 'DELIVERY_VALIDATION_FAILED' } })
      await fill('Site', time); await section.getByRole('button', { name: c.record, exact: true }).click()
      await expect(section.getByRole('alert')).toHaveText(status === 409 ? c.conflict : c.invalid)
      await expect(section.getByLabel(c.destination, { exact: true })).toHaveValue('Site')
      await section.getByRole('button', { name: c.refresh, exact: true }).click()
      await expect(section.getByRole('button', { name: c.record, exact: true })).toBeEnabled()
    }
    expect(context.posts).toHaveLength(3)
  })
  test(`C9e typing during a pending version selection keeps the current delivery form ${lang}`, async ({ page }) => {
    const { c, section, context, props } = await fixture(page, lang), review = (lang === 'en' ? en : zh).changeSets
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    context.versionHook = async route => { await gate; await route.fulfill({ json: { version: props.initial!.versions[1] } }) }
    await page.getByRole('button', { name: new RegExp((lang === 'en' ? 'Version 1' : '版本 1') + ' ·') }).last().click()
    await section.getByLabel(c.destination, { exact: true }).fill('Keep while loading')
    release()
    await expect(page.getByRole('button', { name: review.reloadHistory, exact: true })).toBeEnabled()
    await expect(section.getByLabel(c.destination, { exact: true })).toHaveValue('Keep while loading')
    await expect(page.getByRole('button', { name: review.submitVersion, exact: true })).toBeDisabled()
    page.once('dialog', dialog => dialog.dismiss())
    await page.getByRole('link', { name: review.backToDrafts, exact: true }).click()
    expect(page.url()).toContain('delivery.fixture')
  })
}

for (const lang of ['en', 'zh-HK']) {
  test(`C9e withdrawal preserves independently entered correction fields ${lang}`, async ({ page }) => {
    const { c, section, context, event, fill } = await fixture(page, lang)
    const active = event({ destination: 'Original', deliveredAt: '2026-09-07T00:00:00.000Z', note: 'Original' })
    context.events = [active]; context.active = active.eventId
    await section.getByRole('button', { name: c.refresh, exact: true }).click()
    await expect(section.getByRole('button', { name: c.withdraw, exact: true })).toBeEnabled()
    await fill('Prepared correction')
    await section.getByRole('button', { name: c.withdraw, exact: true }).click()
    await section.getByLabel(c.withdrawReason, { exact: true }).fill('Correcting')
    await section.getByRole('button', { name: c.confirmWithdraw, exact: true }).click()
    await expect(section.getByText(c.withdrawalRecorded, { exact: true })).toBeVisible()
    await expect(section.getByLabel(c.destination, { exact: true })).toHaveValue('Prepared correction')
  })
  test(`C9e decision and delivery dirty states cannot clear each other ${lang}`, async ({ page }) => {
    const { c, section } = await fixture(page, lang, 'pending'), review = (lang === 'en' ? en : zh).changeSets
    await page.getByLabel(review.reason, { exact: true }).fill('Keep decision')
    await section.getByLabel(c.destination, { exact: true }).fill('Keep delivery')
    await page.getByRole('button', { name: review.discardReason, exact: true }).click()
    await expect(page.getByRole('button', { name: review.submitVersion, exact: true })).toBeDisabled()
    await expect(section.getByLabel(c.destination, { exact: true })).toHaveValue('Keep delivery')
    await page.getByLabel(review.reason, { exact: true }).fill('Keep decision')
    page.once('dialog', dialog => dialog.accept())
    await section.getByRole('button', { name: c.discard, exact: true }).click()
    await expect(page.getByRole('button', { name: review.submitVersion, exact: true })).toBeDisabled()
    await expect(page.getByLabel(review.reason, { exact: true })).toHaveValue('Keep decision')
  })
  test(`C9e withdrawal reason typed during version selection survives late response ${lang}`, async ({ page }) => {
    const { c, section, context, props, event } = await fixture(page, lang), review = (lang === 'en' ? en : zh).changeSets
    const active = event({ destination: 'Original', deliveredAt: '2026-09-07T00:00:00.000Z', note: 'Original' })
    context.events = [active]; context.active = active.eventId
    await section.getByRole('button', { name: c.refresh, exact: true }).click()
    await expect(section.getByRole('button', { name: c.withdraw, exact: true })).toBeEnabled()
    let release!: () => void
    const wait = new Promise<void>(resolve => { release = resolve })
    context.versionHook = async route => { await wait; await route.fulfill({ json: { version: props.initial!.versions[1] } }) }
    await page.getByRole('button', { name: new RegExp((lang === 'en' ? 'Version 1' : '版本 1') + ' ·') }).last().click()
    await section.getByRole('button', { name: c.withdraw, exact: true }).click()
    await section.getByLabel(c.withdrawReason, { exact: true }).fill('Keep withdrawal reason')
    release()
    await expect(page.getByRole('button', { name: review.reloadHistory, exact: true })).toBeEnabled()
    await expect(section.getByLabel(c.withdrawReason, { exact: true })).toHaveValue('Keep withdrawal reason')
  })
}

for (const lang of ['en', 'zh-HK']) test(`C9e delayed permission response cannot erase confirmed mutation ${lang}`, async ({ page }) => {
  const { c, section, context, props, history, fill } = await fixture(page, lang)
  const review = (lang === 'en' ? en : zh).changeSets
  await fill('Confirmed destination')
  let release!: () => void, calls = 0
  const wait = new Promise<void>(resolve => { release = resolve })
  const stale = history()
  context.readHook = async route => {
    calls++
    if (calls === 1) { await wait; await route.fulfill({ headers: { 'X-Fixture-Old': '1' }, json: stale }) }
    else await route.fulfill({ json: history() })
  }
  context.versionHook = route => route.fulfill({ json: props.initial })
  await section.getByRole('button', { name: c.refresh, exact: true }).click()
  await expect(section.getByRole('button', { name: c.record, exact: true })).toBeDisabled()
  // An independent review refresh replaces the same version's permission snapshot,
  // starting a newer delivery read while the first GET remains in flight.
  await page.getByRole('button', { name: review.reloadHistory, exact: true }).click()
  await expect(section.getByRole('button', { name: c.record, exact: true })).toBeEnabled()
  await section.getByRole('button', { name: c.record, exact: true }).click()
  await expect(section.getByText(c.recorded, { exact: true })).toBeVisible()
  const response = page.waitForResponse(value => value.headers()['x-fixture-old'] === '1')
  release(); await response
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
  await expect(section.getByText('Confirmed destination', { exact: true })).toBeVisible()
  await expect(section.getByRole('button', { name: c.record, exact: true })).toBeDisabled()
  expect(context.posts).toHaveLength(1)
})

for (const lang of ['en', 'zh-HK']) test(`C9e pending submission retains delivery input and records new history ${lang}`, async ({ page }) => {
  const { c, section, context, version, fill } = await fixture(page, lang)
  const review = (lang === 'en' ? en : zh).changeSets
  const next = { ...version, id: '123e4567-e89b-42d3-a456-426614174099', versionNumber: 2, decision: null, capabilities: { canDecide: false } }
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  context.versionHook = async route => {
    if (route.request().method() === 'POST') { await wait; context.reason = 'superseded' }
    await route.fulfill({ json: { version: next } })
  }
  await page.getByRole('button', { name: review.submitVersion, exact: true }).click()
  await fill('Keep input during submission')
  const reads = context.reads
  release()
  await expect(page.getByRole('button', { name: review.reloadHistory, exact: true })).toBeEnabled()
  await expect(section.getByLabel(c.destination, { exact: true })).toHaveValue('Keep input during submission')
  const newVersion = page.getByRole('button', { name: new RegExp((lang === 'en' ? 'Version 2' : '版本 2') + ' ·') })
  await expect(newVersion).toBeVisible()
  await expect(newVersion).toHaveAttribute('aria-pressed', 'false')
  await expect(newVersion).toBeDisabled()
  await expect.poll(() => context.reads).toBeGreaterThan(reads)
  await expect(section.getByRole('button', { name: c.record, exact: true })).toBeDisabled()
  await expect(section.getByText(c.superseded, { exact: true })).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  await section.getByRole('button', { name: c.discard, exact: true }).click()
  await expect(newVersion).toBeEnabled()
  await newVersion.click()
  await expect(newVersion).toHaveAttribute('aria-pressed', 'true')
  await expect(section.getByLabel(c.destination, { exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: review.submitVersion, exact: true })).toBeEnabled()
})
