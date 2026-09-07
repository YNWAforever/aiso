import { test, expect, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'
import { outcomes, outcome } from '../../__tests__/components/c9f-fixtures'
import type { VersionWorkspaceProps } from '../../components/change-sets/VersionWorkspace'
import type { OutcomeResponse } from '../../lib/outcomes/types'
import type { DeliveryEvent, DeliveryPage } from '../../lib/delivery/types'
const errors = new WeakMap<Page, string[]>()
async function fixture(page: Page, lang: string, initial: OutcomeResponse = outcomes.noDelivery) {
  const dir = process.env.C9F_HTML_DIR!, css = process.env.C9F_CSS_PATH!
  if (!dir || !css) throw Error('C9F fixtures required')
  const props = JSON.parse(readFileSync(dir + '/' + lang + '-data.json', 'utf8')) as VersionWorkspaceProps
  const version = props.initialVersion!, older = { ...version, id: props.initial!.versions[1].id }
  const c = (lang === 'en' ? en : zh).outcomes, d = (lang === 'en' ? en : zh).delivery
  const state = { value: initial, reads: 0, mutations: [] as string[], events: [] as DeliveryEvent[], active: null as string | null,
    hook: null as ((route: Route) => Promise<void>) | null, mutationHook: null as ((route: Route) => Promise<void>) | null }
  const pageErrors: string[] = []; errors.set(page, pageErrors); page.on('pageerror', e => pageErrors.push(e.message))
  // Deliberately model an uncancellable transport so request-generation guards,
  // independently of AbortController, must reject late fulfilled bodies.
  await page.addInitScript(() => {
    const original = window.fetch
    window.fetch = (input, options) => original(input, String(input).endsWith('/outcomes') ? { ...options, signal: undefined } : options)
  })
  await page.route('**/*', route => route.abort())
  await page.route('**/api/clients/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname
    if (req.method() !== 'GET') state.mutations.push(path)
    if (path.endsWith('/outcomes')) {
      expect(req.method()).toBe('GET'); expect(new URL(req.url()).search).toBe('')
      state.reads++
      return state.hook ? state.hook(route) : route.fulfill({ json: state.value })
    }
    if (path.includes('/delivery') && req.method() === 'POST') {
      if (state.mutationHook) return state.mutationHook(route)
      const body = req.postDataJSON(), withdrawal = path.endsWith('/withdraw'), eventId = randomUUID()
      const event: DeliveryEvent = { schemaVersion: 1, eventId, versionId: version.id, contentHash: version.contentHash,
        actor: { profileId: '123e4567-e89b-42d3-a456-426614174001', displayName: null, role: 'account_member' }, recordedAt: '2026-09-07T01:00:00Z',
        ...(withdrawal ? { kind: 'withdraw', targetAttestationId: state.active!, reason: body.reason } : { kind: 'attest', destination: body.destination, deliveredAt: body.deliveredAt, note: body.note }) }
      state.events.unshift(event); state.active = withdrawal ? null : eventId
      state.value = withdrawal ? outcomes.withdrawn : outcome({ anchor: { id: eventId, deliveredAt: body.deliveredAt, recordedAt: event.recordedAt } })
      return route.fulfill({ status: 201, json: { event } })
    }
    if (path.endsWith('/delivery')) {
      const history: DeliveryPage = { events: state.events, activeAttestationId: state.active, nextCursor: null,
        capabilities: { canExport: true, canAttest: !state.active, canWithdraw: Boolean(state.active), attestReason: state.active ? 'active_attestation' : null, withdrawReason: state.active ? null : 'no_active_attestation' } }
      return route.fulfill({ json: history })
    }
    return route.fulfill({ json: { version: path.includes(older.id) ? older : version } })
  })
  await page.route(`https://outcomes.fixture/${lang}`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Outcomes</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${readFileSync(css, 'utf8')}</style></head><body>${readFileSync(dir + '/' + lang + '-default.html', 'utf8')}<script>${readFileSync(dir + '/fixture.js', 'utf8')}</script></body></html>` }))
  await page.goto(`https://outcomes.fixture/${lang}`)
  await page.waitForFunction(() => Boolean((window as Window & { c9cFixtureReady?: boolean }).c9cFixtureReady))
  const section = page.getByRole('region', { name: c.title, exact: true }), delivery = page.getByRole('region', { name: d.title, exact: true })
  await expect(section).toHaveAttribute('aria-busy', 'false')
  await expect(delivery).toHaveAttribute('aria-busy', 'false')
  const refresh = () => section.getByRole('button', { name: c.refresh, exact: true }).click()
  const fill = async () => {
    await delivery.getByLabel(d.destination, { exact: true }).fill('Keep my destination')
    await delivery.getByLabel(d.timeUtc, { exact: true }).fill('2026-09-07T00:00')
    await delivery.getByLabel(d.note, { exact: true }).fill('Keep my note')
  }
  return { c, d, state, section, delivery, refresh, fill, older }
}
test.afterEach(({ page }) => expect(errors.get(page) ?? []).toEqual([]))
for (const lang of ['en', 'zh-HK']) {
  for (const [name, value] of Object.entries(outcomes)) test(`C9f ${name} separates timing and limitations ${lang}`, async ({ page }) => {
    const { c, section, state, refresh } = await fixture(page, lang, value)
    await expect(section.getByText(c.anchorState + ': ' + c.anchorStates[value.anchorState], { exact: true })).toBeVisible()
    await expect(section.getByText(value.baseline?.source.id ?? c.reasons['baseline-missing'], { exact: true }).first()).toBeVisible()
    for (const w of value.windows) {
      const card = section.getByRole('article', { name: c.window.replace('{day}', String(w.day)), exact: true })
      await expect(card.getByText(c.timeState + ': ' + c.timeStates[w.timeState], { exact: true })).toBeVisible()
      await expect(card.getByText(c.evidenceState + ': ' + c.evidenceStates[w.evidenceState], { exact: true })).toBeVisible()
      if (w.provisional) await expect(card.getByText(c.provisional, { exact: true })).toBeVisible()
    }
    if (name === 'pulse') await expect(section.getByText('retained-pulse', { exact: true })).toBeVisible()
    await refresh(); await expect(section).toHaveAttribute('aria-busy', 'false')
    expect(state.mutations).toEqual([])
    await expect(section.getByRole('link')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (name === 'scan' || name === 'pulse') expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })
  test(`C9f outcome refresh preserves typed delivery input and keyboard focus ${lang}`, async ({ page }) => {
    const { c, d, section, delivery, state, fill } = await fixture(page, lang, outcomes.pulse)
    await fill()
    const button = section.getByRole('button', { name: c.refresh, exact: true })
    await button.focus(); await page.keyboard.press('Enter')
    await expect(section).toHaveAttribute('aria-busy', 'false')
    await expect(button).toBeFocused()
    await expect(section.locator('[aria-live="polite"]')).toHaveText(c.loaded)
    await expect(delivery.getByLabel(d.destination, { exact: true })).toHaveValue('Keep my destination')
    await expect(delivery.getByLabel(d.note, { exact: true })).toHaveValue('Keep my note')
    expect(state.mutations).toEqual([])
  })
  for (const failure of ['503', 'network', 'malformed', 'scope', '401', '403']) test(`C9f ${failure} clears protected outcome data and retries without erasing input ${lang}`, async ({ page }) => {
    const { c, d, section, delivery, state, refresh, fill } = await fixture(page, lang, outcomes.scan)
    await fill()
    state.hook = route => failure === 'network' ? route.abort() : failure === 'malformed' ? route.fulfill({ json: { ...outcomes.scan, rawAnswer: 'forbidden' } }) : failure === 'scope' ? route.fulfill({ json: { ...outcomes.scan, clientId: 'other-client' } }) : route.fulfill({ status: Number(failure), json: { error: 'failure' } })
    await refresh()
    await expect(section.getByRole('alert')).toHaveText(failure === '401' ? c.unauthenticated : failure === '403' ? c.denied : c.unavailable)
    await expect(section.getByText('selected-scan', { exact: true })).toHaveCount(0)
    await expect(delivery.getByLabel(d.destination, { exact: true })).toHaveValue('Keep my destination')
    state.hook = null; state.value = outcomes.pulse
    await section.getByRole('button', { name: c.retry, exact: true }).click()
    await expect(section.getByText('retained-pulse', { exact: true })).toBeVisible()
    expect(state.mutations).toEqual([])
  })
  test(`C9f late result cannot replace a newly selected version ${lang}`, async ({ page }) => {
    const { c, state, section, refresh, older } = await fixture(page, lang, outcomes.scan)
    let release!: () => void, calls = 0
    const wait = new Promise<void>(resolve => { release = resolve })
    state.hook = async route => {
      calls++
      if (calls === 1) { await wait; await route.fulfill({ headers: { 'X-Fixture-Stale': '1' }, json: outcomes.scan }) }
      else await route.fulfill({ json: outcome({ versionId: older.id, anchorState: 'no-delivery', anchor: null }) })
    }
    await refresh(); await expect.poll(() => calls).toBe(1)
    await page.getByRole('button', { name: new RegExp((lang === 'en' ? 'Version 1' : '版本 1') + ' ·') }).last().click()
    await expect(section.getByText(c.anchorState + ': ' + c.anchorStates['no-delivery'], { exact: true })).toBeVisible()
    const response = page.waitForResponse(r => r.headers()['x-fixture-stale'] === '1')
    release(); await response
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
    await expect(section.getByText(older.id, { exact: true })).toBeVisible()
    await expect(section.getByText('selected-scan', { exact: true })).toHaveCount(0)
    expect(state.mutations).toEqual([])
  })
  test(`C9f withdrawal replacement invalidates pending reads and retains correction input ${lang}`, async ({ page }) => {
    const { c, d, state, section, delivery, fill, refresh } = await fixture(page, lang)
    await fill(); await delivery.getByRole('button', { name: d.record, exact: true }).click()
    await expect(section.getByText(c.anchorState + ': ' + c.anchorStates.active, { exact: true })).toBeVisible()
    const oldAnchor = state.value.anchor!.id, stale = state.value
    let release!: () => void, calls = 0
    const wait = new Promise<void>(resolve => { release = resolve })
    state.hook = async route => {
      calls++
      if (calls === 1) { await wait; await route.fulfill({ headers: { 'X-Fixture-Stale': '1' }, json: stale }) }
      else await route.fulfill({ json: state.value })
    }
    await fill(); await refresh(); await expect.poll(() => calls).toBe(1)
    await delivery.getByRole('button', { name: d.withdraw, exact: true }).click()
    await delivery.getByLabel(d.withdrawReason, { exact: true }).fill('Correcting')
    await delivery.getByRole('button', { name: d.confirmWithdraw, exact: true }).click()
    await expect(section.getByText(c.anchorState + ': ' + c.anchorStates.withdrawn, { exact: true })).toBeVisible()
    await expect(delivery.getByLabel(d.destination, { exact: true })).toHaveValue('Keep my destination')
    await expect(section.getByText(oldAnchor, { exact: true })).toHaveCount(0)
    await delivery.getByRole('button', { name: d.record, exact: true }).click()
    await expect(section.getByText(c.anchorState + ': ' + c.anchorStates.active, { exact: true })).toBeVisible()
    const replacement = state.value.anchor!.id
    expect(replacement).not.toBe(oldAnchor)
    const response = page.waitForResponse(r => r.headers()['x-fixture-stale'] === '1')
    release(); await response
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
    await expect(section.getByText(replacement, { exact: true })).toBeVisible()
    await expect(section.getByText(oldAnchor, { exact: true })).toHaveCount(0)
    expect(state.mutations).toHaveLength(3)
  })
  test(`C9f malformed delivery success does not invalidate outcomes ${lang}`, async ({ page }) => {
    const { d, state, delivery, fill } = await fixture(page, lang)
    const reads = state.reads
    state.mutationHook = route => route.fulfill({ status: 201, json: { event: {} } })
    await fill(); await delivery.getByRole('button', { name: d.record, exact: true }).click()
    await expect(delivery.getByRole('alert')).toHaveText(d.unavailable)
    expect(state.reads).toBe(reads)
    await expect(delivery.getByLabel(d.destination, { exact: true })).toHaveValue('Keep my destination')
  })
}
