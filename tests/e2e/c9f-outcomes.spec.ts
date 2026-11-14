import { test, expect, type Locator, type Page, type Route, type TestInfo } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'
import { outcomes, outcome, smeComparisonCases, smeOutcomes } from '../../__tests__/components/c9f-fixtures'
import type { VersionWorkspaceProps } from '../../components/change-sets/VersionWorkspace'
import type { OutcomeResponse } from '../../lib/outcomes/types'
import type { DeliveryEvent, DeliveryPage } from '../../lib/delivery/types'
import type { C9EVersionWorkspaceFixtureProps } from '../../__tests__/components/c9e-workspace-fixture'
import type { SelectedOutcomeResponse } from '../../lib/outcomes/client-context'
import type { MultiSourceOutcomeResponse } from '../../lib/outcomes/multi-source'
const errors = new WeakMap<Page, string[]>()
async function fixture(page: Page, lang: string, initial: OutcomeResponse = outcomes.noDelivery, variant = 'default') {
  const dir = process.env.C9F_HTML_DIR!, css = process.env.C9F_CSS_PATH!
  if (!dir || !css) throw Error('C9F fixtures required')
  const props = JSON.parse(readFileSync(dir + '/' + lang + (variant === 'default' ? '' : '-' + variant) + '-data.json', 'utf8')) as VersionWorkspaceProps
  const version = props.initialVersion!, older = { ...version, id: props.initial!.versions[1]?.id ?? version.id }
  const c = (lang === 'en' ? en : zh).outcomes, d = (lang === 'en' ? en : zh).delivery
  const state = { value: initial, reads: 0, mutations: [] as string[], events: [] as DeliveryEvent[], active: null as string | null,
    hook: null as ((route: Route) => Promise<void>) | null, mutationHook: null as ((route: Route) => Promise<void>) | null }
  const pageErrors: string[] = []; errors.set(page, pageErrors); page.on('pageerror', e => pageErrors.push(e.message))
  page.on('request', request => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) state.mutations.push(new URL(request.url()).pathname)
  })
  // Deliberately model an uncancellable transport so request-generation guards,
  // independently of AbortController, must reject late fulfilled bodies.
  await page.addInitScript(() => {
    const original = window.fetch
    window.fetch = (input, options) => original(input, String(input).endsWith('/outcomes') ? { ...options, signal: undefined } : options)
  })
  await page.route('**/*', route => route.abort())
  await page.route('**/api/clients/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname
    if (path.endsWith('/outcomes')) {
      expect(req.method()).toBe('GET'); expect(new URL(req.url()).search).toBe('')
      state.reads++
      if (state.hook) return state.hook(route)
      return version.schemaVersion === 2 ? route.fulfill({ status: 503, json: { error: 'OUTCOMES_UNAVAILABLE' } }) : route.fulfill({ json: state.value })
    }
    if (path.includes('/delivery') && req.method() === 'POST') {
      if (state.mutationHook) return state.mutationHook(route)
      const body = req.postDataJSON(), withdrawal = path.endsWith('/withdraw'), eventId = randomUUID()
      const event: DeliveryEvent = { schemaVersion: 1, eventId, versionId: version.id, contentHash: version.contentHash,
        actor: { profileId: '123e4567-e89b-42d3-a456-426614174001', displayName: null, role: 'account_member' }, recordedAt: '2026-09-07T01:00:00Z',
        ...(withdrawal ? { kind: 'withdraw', targetAttestationId: state.active!, reason: body.reason } : { kind: 'attest', destination: body.destination, deliveredAt: body.deliveredAt, note: body.note, provenance: 'self_reported' }) }
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
  await page.route(`https://outcomes.fixture/${lang}`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Outcomes</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${readFileSync(css, 'utf8')}</style></head><body>${readFileSync(dir + '/' + lang + '-' + variant + '.html', 'utf8')}<script>${readFileSync(dir + '/fixture.js', 'utf8')}</script></body></html>` }))
  await page.goto(`https://outcomes.fixture/${lang}`)
  await page.waitForFunction(() => Boolean((window as Window & { c9cFixtureReady?: boolean }).c9cFixtureReady))
  const section = page.getByRole('region', { name: c.title, exact: true }), delivery = page.getByRole('region', { name: variant === 'default' ? d.title : d.sme.title, exact: true, includeHidden: variant !== 'default' })
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

for (const lang of ['en', 'zh-HK']) {
  for (const example of smeComparisonCases) test(`PR4 mounted SME outcomes ${example.name} preserve basis movement and exact windows ${lang}`, async ({ page }) => {
    const value = smeOutcomes[example.name]
    const { c, section, state, refresh } = await fixture(page, lang, value, 'sme')
    const first = section.getByRole('article').first()
    await expect(first.getByText(c.comparisonBasis + ': ' + (example.status === 'not_comparable' ? c.sme.notComparable : c.comparisonStatuses[example.status]), { exact: true })).toBeVisible()
    await expect(first.getByText(c.comparisonChange + ': ' + c.comparisonOutcomes[example.change], { exact: true })).toBeVisible()
    await expect(first.getByText(c.comparisonBaseline + ': ' + c.verdicts[example.baseline.verdict as keyof typeof c.verdicts], { exact: true })).toBeVisible()
    await expect(first.getByText(c.comparisonObserved + ': ' + (example.selected ? c.verdicts[example.selected.verdict as keyof typeof c.verdicts] : c.unknown), { exact: true })).toBeVisible()
    await expect(first.getByText(c.sme.comparisonLimitation, { exact: true })).toBeVisible()
    await expect(first.getByText(c.provisional, { exact: true })).toHaveCount(example.selected ? 1 : 0)
    if (example.status === 'partially_comparable') {
      await expect(section.getByText(c.sme.pathLimitation, { exact: true }).first()).toBeVisible()
      await expect(section.getByText(c.reasons['final-path-identity-withheld'], { exact: true })).toHaveCount(0)
    }
    for (const window of value.windows) {
      const card = section.getByRole('article', { name: c.window.replace('{day}', String(window.day)), exact: true })
      await expect(card.locator(`time[datetime="${window.startsAt}"]`)).toBeVisible()
      await expect(card.locator(`time[datetime="${window.endsAt}"]`)).toBeVisible()
      const start = Date.parse(value.anchor!.deliveredAt) + window.day * 86_400_000
      expect(Date.parse(window.startsAt)).toBe(start); expect(Date.parse(window.endsAt)).toBe(start + 7 * 86_400_000)
      await expect(card.getByText(c.timeState + ': ' + c.timeStates[window.timeState], { exact: true })).toBeVisible()
      await expect(card.getByText(c.evidenceState + ': ' + c.evidenceStates[window.evidenceState], { exact: true })).toBeVisible()
    }
    await expect(section.getByText(c.sme.intervalPolicy, { exact: true })).toBeVisible()
    await expect(section.getByText(c.sme.anchorLimitation, { exact: true })).toBeVisible()
    await expect(section.getByText(c.reasons['self-reported-delivery'], { exact: true })).toHaveCount(0)
    const details = section.locator('summary').filter({ hasText: c.sme.technicalDetails })
    await details.focus(); await page.keyboard.press('Enter')
    await expect(section.getByText(c.sme.anchorId + ': ' + value.anchor!.id, { exact: true })).toBeVisible()
    await expect(section.getByText(c.contentHash + ': ' + value.contentHash, { exact: true })).toBeVisible()
    for (const summary of await section.locator('summary').filter({ hasText: c.sme.sourceDetails }).all()) await summary.click()
    await expect(section.getByText(c.source + ': ' + example.baseline.source.id, { exact: true })).toBeVisible()
    if (example.selected) await expect(first.getByText(c.source + ': ' + example.selected.source.id, { exact: true })).toBeVisible()
    const reads = state.reads
    await refresh(); await expect.poll(() => state.reads).toBe(reads + 1)
    await expect(section).toHaveAttribute('aria-busy', 'false'); expect(state.mutations).toEqual([])
  })

  test(`PR4 mounted Pulse timing missing evidence and neutral anchors stay honest ${lang}`, async ({ page }) => {
    const { c, section, state, refresh } = await fixture(page, lang, outcomes.pulse, 'sme')
    await expect(section.getByText(c.sme.pulseUnranked, { exact: true }).first()).toBeVisible()
    await expect(section.getByRole('heading', { name: c.baseline, exact: true }).locator('..').getByText(c.collectedAt + ': ' + c.collectionUnknown, { exact: true })).toBeVisible()
    await expect(section.getByText(c.comparisonChange + ': ' + c.comparisonOutcomes.improved, { exact: true })).toHaveCount(0)
    await expect(section.getByText(c.comparisonChange + ': ' + c.comparisonOutcomes.regressed, { exact: true })).toHaveCount(0)
    await expect(section.getByText(c.sme.anchorLimitation, { exact: true })).toBeVisible()
    for (const value of [outcomes.awaiting, outcomes.missing, outcomes.unavailable, outcomes.noDelivery, outcomes.withdrawn]) {
      state.value = value; await refresh(); await expect(section).toHaveAttribute('aria-busy', 'false')
      await expect(section.getByText(c.sme.anchorState + ': ' + c.sme.anchorStates[value.anchorState], { exact: true })).toBeVisible()
      for (const window of value.windows) {
        const card = section.getByRole('article', { name: c.window.replace('{day}', String(window.day)), exact: true })
        await expect(card.getByText(c.timeState + ': ' + c.timeStates[window.timeState], { exact: true })).toBeVisible()
        await expect(card.getByText(c.evidenceState + ': ' + c.evidenceStates[window.evidenceState], { exact: true })).toBeVisible()
        if (!window.selected) await expect(card.getByText(c.sme.noSelectedEvidence, { exact: true })).toBeVisible()
      }
    }
    expect(state.mutations).toEqual([])
  })

  for (const variant of ['smeV2', 'smeSingleV2']) test(`PR4 actual ${variant} outcome 503 explains a failed V2 read and preserves auth errors ${lang}`, async ({ page }) => {
    const { c, section, state } = await fixture(page, lang, outcomes.scan, variant)
    await expect(section.getByRole('alert')).toHaveText(c.sme.multiSourceUnavailable)
    await expect(section.getByRole('article')).toHaveCount(0)
    await expect(section.getByText(c.baseline, { exact: true })).toHaveCount(0)
    for (const [status, copy] of [[401, c.unauthenticated], [403, c.denied]] as const) {
      state.hook = route => route.fulfill({ status, json: { error: status === 401 ? 'OUTCOMES_UNAUTHENTICATED' : 'OUTCOMES_DENIED' } })
      await section.getByRole('button', { name: c.retry, exact: true }).click()
      await expect(section.getByRole('alert')).toHaveText(copy)
      await expect(section.getByText(c.sme.multiSourceUnavailable, { exact: true })).toHaveCount(0)
    }
    state.hook = null
    await section.getByRole('button', { name: c.retry, exact: true }).click()
    await expect(section.getByRole('alert')).toHaveText(c.sme.multiSourceUnavailable)
    expect(state.reads).toBe(4); expect(state.mutations).toEqual([])
  })

  test(`PR4 SME withdrawal replacement wins over an older observation read ${lang}`, async ({ page }) => {
    const { c, d, state, section, delivery, fill, refresh } = await fixture(page, lang, outcomes.noDelivery, 'sme')
    await page.locator('summary').filter({ hasText: (lang === 'en' ? en : zh).changeSets.sme.manualPath }).click()
    await fill(); await delivery.getByRole('button', { name: d.record, exact: true }).click()
    await expect(section.getByText(c.sme.anchorState + ': ' + c.sme.anchorStates.active, { exact: true })).toBeVisible()
    const stale = state.value, original = stale.anchor!.id
    let held!: Route, calls = 0
    state.hook = async route => {
      if (++calls === 1) held = route
      else await route.fulfill({ json: state.value })
    }
    await fill(); await refresh(); await expect.poll(() => Boolean(held)).toBe(true)
    await delivery.getByRole('button', { name: d.sme.withdraw, exact: true }).click()
    await delivery.getByLabel(d.withdrawReason, { exact: true }).fill('Correct saved context')
    await delivery.getByRole('button', { name: d.confirmWithdraw, exact: true }).click()
    await expect(section.getByText(c.sme.anchorState + ': ' + c.sme.anchorStates.withdrawn, { exact: true })).toBeVisible()
    await expect(delivery.getByLabel(d.destination, { exact: true })).toHaveValue('Keep my destination')
    await delivery.getByRole('button', { name: d.record, exact: true }).click()
    await expect(section.getByText(c.sme.anchorState + ': ' + c.sme.anchorStates.active, { exact: true })).toBeVisible()
    const replacement = state.value.anchor!.id
    expect(replacement).not.toBe(original)
    const response = page.waitForResponse(r => r.headers()['x-fixture-old-observation'] === '1')
    await held.fulfill({ headers: { 'X-Fixture-Old-Observation': '1' }, json: stale }); await response
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
    await section.locator('summary').filter({ hasText: c.sme.technicalDetails }).click()
    await expect(section.getByText(c.sme.anchorId + ': ' + replacement, { exact: true })).toBeVisible()
    await expect(section.getByText(c.sme.anchorId + ': ' + original, { exact: true })).toHaveCount(0)
    expect(state.mutations).toHaveLength(3)
  })
}

// PR3 fixtures are emitted JSON only. Do not import the Node scenario/freezer/projector
// here or manufacture a successful multi-source response in the browser harness.
type PacketVariant = 'v2Mixed' | 'v2Single' | 'ctxV2' | 'ctxV2Alt' | 'ctxV1'
type PacketClock = 'early' | 'mature-d7'
type PacketProfile = 'stored' | 'unavailable-scan' | 'limited-scan' | 'diagnostic-heavy'
type OutcomePacket = {
  props: C9EVersionWorkspaceFixtureProps
  values: Record<PacketClock, Record<PacketProfile, SelectedOutcomeResponse>>
  delivery: DeliveryPage
  viewerKeys: Record<'owner' | 'reviewer', string>
}
type ReadProbe = {
  calls: { method: string; cache: RequestCache | undefined; search: string; headers: string[] }[]
  holdBody: boolean
  bodyEntered: number
  bodyReleased: number
  releaseBody?: () => void
}
type ReadOnlyState = {
  value: unknown; reads: number; mutations: string[]; unexpected: string[]
  hook: ((route: Route) => Promise<void>) | null
}
const readOnlyHealth = new WeakMap<Page, ReadOnlyState>()
const exactText = (text: string) => new RegExp('^' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')
function packet(lang: 'en' | 'zh-HK', variant: PacketVariant): OutcomePacket {
  if (!process.env.C9F_HTML_DIR) throw Error('Node-produced C9F packets required')
  return JSON.parse(readFileSync(`${process.env.C9F_HTML_DIR}/${lang}-${variant}-packet.json`, 'utf8')) as OutcomePacket
}
function multi(value: SelectedOutcomeResponse): MultiSourceOutcomeResponse {
  if (value.schemaVersion !== 2) throw Error('Expected Node-produced V2 packet')
  return value
}
const sourcesIn = (section: Locator) => section.locator('section[aria-labelledby]')
async function nextPaint(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}
async function readDetails(section: Locator, copy: typeof en.outcomes, schema: 1 | 2) {
  const summary = section.locator('summary').filter({ hasText: exactText(schema === 2 ? copy.v2.readDetails : copy.sme.technicalDetails) })
  const details = summary.locator('..')
  if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) await summary.click()
  return details
}
async function outcomeQuality(page: Page, section: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const ids = await page.locator('[id]').evaluateAll(elements => elements.map(element => element.id).filter(Boolean))
  expect(new Set(ids).size).toBe(ids.length)
  for (const control of await section.locator('button:visible, summary:visible').all()) {
    expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
}
async function populatedShot(page: Page, info: TestInfo, label: string) {
  if (info.project.name !== 'chromium') return
  const path = info.outputPath(`${label}.png`)
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  await info.attach(label, { path, contentType: 'image/png' })
}
async function nodeFixture(page: Page, lang: 'en' | 'zh-HK', variant: PacketVariant, options: {
  clock?: PacketClock; profile?: PacketProfile; width?: number; dark?: boolean
} = {}) {
  const dir = process.env.C9F_HTML_DIR, css = process.env.C9F_CSS_PATH
  if (!dir || !css) throw Error('Paired C9F renderer HTML, Node packets and real build CSS required')
  const data = packet(lang, variant), props = data.props, version = props.initialVersion!
  const copy = (lang === 'en' ? en : zh).outcomes
  const value = data.values[options.clock ?? 'mature-d7'][options.profile ?? 'stored']
  const state: ReadOnlyState = { value, reads: 0, mutations: [], unexpected: [], hook: null }
  readOnlyHealth.set(page, state)
  const pageErrors: string[] = []; errors.set(page, pageErrors)
  page.on('pageerror', failure => pageErrors.push(failure.message))
  page.on('request', request => { if (request.method() !== 'GET') state.mutations.push(request.method() + ' ' + new URL(request.url()).pathname) })
  if (options.width) await page.setViewportSize({ width: options.width, height: 900 })
  await page.emulateMedia({ colorScheme: options.dark ? 'dark' : 'light', reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    const current = window as typeof window & { c9fReadProbe: ReadProbe }
    const probe: ReadProbe = { calls: [], holdBody: false, bodyEntered: 0, bodyReleased: 0 }
    current.c9fReadProbe = probe
    const original = window.fetch
    window.fetch = async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href)
      if (!url.pathname.endsWith('/outcomes')) return original(input, options)
      const held = probe.holdBody
      if (held) probe.holdBody = false
      const request = input instanceof Request ? input : undefined
      probe.calls.push({ method: options?.method ?? request?.method ?? 'GET', cache: options?.cache ?? request?.cache, search: url.search,
        headers: Array.from(new Headers(options?.headers ?? request?.headers).keys()) })
      // Replace the application's signal with a never-aborted transport signal,
      // independently from the separately held response.json promise below.
      const response = await original(input, { ...options, signal: new AbortController().signal })
      if (held) {
        const json = response.json.bind(response)
        response.json = async () => {
          const body: unknown = await json()
          probe.bodyEntered++
          await new Promise<void>(resolve => { probe.releaseBody = () => resolve() })
          probe.bodyReleased++
          return body
        }
      }
      return response
    }
  })
  const origin = 'https://outcomes.fixture', versions = `/api/clients/${props.clientId}/work-items/${props.workItemId}/versions`
  const selected = versions + '/' + version.id
  await page.routeWebSocket('**/*', socket => { state.unexpected.push('WebSocket ' + socket.url()); socket.close() })
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (request.method() !== 'GET' || url.origin !== origin || url.search) {
      state.unexpected.push(request.method() + ' ' + request.url()); await route.abort(); return
    }
    if (url.pathname === `/${lang}`) {
      await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${lang}" class="${options.dark ? 'dark' : ''}"><head><meta charset="utf-8"><title>Stored source comparisons</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${readFileSync(css, 'utf8')}</style></head><body>${readFileSync(`${dir}/${lang}-${variant}.html`, 'utf8')}<script>${readFileSync(`${dir}/fixture.js`, 'utf8')}</script></body></html>` }); return
    }
    if (url.pathname === '/favicon.ico') { await route.fulfill({ status: 204 }); return }
    if (url.pathname === selected + '/outcomes') {
      state.reads++
      if (state.hook) await state.hook(route)
      else await route.fulfill({ json: state.value })
      return
    }
    if (url.pathname === selected + '/delivery') { await route.fulfill({ json: data.delivery }); return }
    if (url.pathname === selected) { await route.fulfill({ json: { version } }); return }
    if (url.pathname === versions) { await route.fulfill({ json: props.initial }); return }
    state.unexpected.push(request.method() + ' ' + request.url()); await route.abort()
  })
  await page.goto(`${origin}/${lang}`)
  await page.waitForFunction(() => Boolean((window as Window & { c9cFixtureReady?: boolean }).c9cFixtureReady))
  const section = page.getByRole('region', { name: copy.title, exact: true })
  await expect(section).toHaveAttribute('aria-busy', 'false')
  await expect(section.getByRole('alert')).toHaveCount(0)
  const refresh = () => section.getByRole('button', { name: copy.refresh, exact: true }).click()
  return { data, props, value, copy, state, section, refresh }
}
async function committedContext(page: Page, props: C9EVersionWorkspaceFixtureProps, title: string) {
  // This intentionally updates the direct OutcomeWorkspace child, NOT the
  // parent's one-shot initialVersion seed or its actual history selector.
  return page.evaluate(({ props, title }) => {
    window.dispatchEvent(new CustomEvent('fixture-delivery-scope', { detail: props }))
    const section = Array.from(document.querySelectorAll('section[aria-label]')).find(element => element.getAttribute('aria-label') === title)!
    return { articles: section.querySelectorAll('article').length, details: section.querySelectorAll('details').length,
      busy: section.getAttribute('aria-busy'), text: section.textContent ?? '' }
  }, { props, title })
}

test.afterEach(async ({ page }) => {
  const state = readOnlyHealth.get(page)
  if (!state) return
  expect(state.mutations).toEqual([]); expect(state.unexpected).toEqual([])
  const calls = await page.evaluate(() => (window as typeof window & { c9fReadProbe: ReadProbe }).c9fReadProbe.calls)
  expect(calls.length).toBeGreaterThan(0)
  for (const call of calls) {
    expect(call.method).toBe('GET'); expect(call.cache).toBe('no-store')
    expect(call.search).toBe(''); expect(call.headers).toEqual([])
  }
})

const malformedKinds = ['hash', 'schema', 'count', 'ordinal', 'ref', 'order', 'policy', 'extra', 'diagnostics401'] as const
type MalformedKind = typeof malformedKinds[number]
function malformedWire(genuine: MultiSourceOutcomeResponse, kind: MalformedKind): unknown {
  // Negative wire forgeries only; all successful reads use emitted genuine DTOs.
  const bad = structuredClone(genuine), wire = bad as unknown as Record<string, unknown>
  if (kind === 'hash') wire.contentHash = 'f'.repeat(64)
  else if (kind === 'schema') wire.schemaVersion = 1
  else if (kind === 'count') bad.sources.pop()
  else if (kind === 'ordinal') bad.sources[1].sourceIndex = 0
  else if (kind === 'ref') bad.sources[0].baseline!.source.id = 'c1500000-0000-4000-8000-000000000099'
  else if (kind === 'order') {
    const first = bad.sources[0]
    bad.sources[0] = bad.sources[1]; bad.sources[1] = first
    bad.sources.forEach((source, index) => { source.sourceIndex = index })
  } else if (kind === 'policy') wire.policyVersion = 'stored-outcomes.v1'
  else if (kind === 'extra') wire.rawAnswer = 'Untrusted extra property'
  else {
    const last = bad.sources[0].diagnostics.at(-1)
    if (!last) throw Error('Actual diagnostic-heavy packet required')
    const extra = structuredClone(last)
    extra.source.id = last.source.id.slice(0, 24) + (BigInt('0x' + last.source.id.slice(24)) + BigInt(1)).toString(16).padStart(12, '0')
    bad.sources[0].diagnostics.push(extra)
    expect(new Set(bad.sources[0].diagnostics.map(row => row.source.id)).size).toBe(bad.sources[0].diagnostics.length)
    expect(bad.sources.reduce((count, source) => count + source.diagnostics.length, 0)).toBe(401)
  }
  return wire
}

test.describe('PR3 genuine V2 mounted reads and controlled child fences', () => {
  test.setTimeout(60_000)
  test.use({ serviceWorkers: 'block' })
  for (const lang of ['en', 'zh-HK'] as const) {
    for (const variant of ['v2Mixed', 'v2Single'] as const) for (const clock of ['early', 'mature-d7'] as const) {
      test(`PR3 ${variant} actual ${clock} stored windows and full precision ${lang}`, async ({ page }) => {
        const f = await nodeFixture(page, lang, variant, { clock }), value = multi(f.value), cards = sourcesIn(f.section)
        expect(f.props.initial!.versions).toHaveLength(1)
        await expect(cards).toHaveCount(variant === 'v2Mixed' ? 3 : 1)
        await expect(f.section.getByRole('article')).toHaveCount(value.sources.length * 3)
        await expect(f.section.locator('details[open]')).toHaveCount(0)
        for (const [index, source] of value.sources.entries()) {
          const card = cards.nth(index)
          await expect(card.getByRole('heading', { level: 3 })).toContainText(f.copy.v2.sourceNumber.replace('{number}', String(index + 1)))
          if (source.baseline!.source.kind === 'pulse-metric') {
            const frozen = f.props.initialVersion!.schemaVersion === 2 ? f.props.initialVersion!.evidenceSnapshots[index].evidence : null
            if (!frozen || frozen.kind !== 'pulse-metric') throw Error('Actual selected frozen Pulse evidence required')
            await expect(card.getByRole('heading', { level: 3 })).toContainText(frozen.question)
            await expect(card.getByRole('heading', { level: 3 })).toContainText(frozen.platform)
            await expect(card.getByText(f.copy.sme.pulseUnranked, { exact: true })).toBeVisible()
            await expect(card.locator('p:visible').filter({ hasText: exactText(f.copy.comparisonChange + ': ' + f.copy.comparisonOutcomes.improved) })).toHaveCount(0)
          }
          for (const [position, window] of source.windows.entries()) {
            const article = card.getByRole('article').nth(position), summary = article.locator('summary')
            await expect(article.getByText(f.copy.timeStates[window.timeState], { exact: true })).toBeVisible()
            const basis = f.copy.comparisonBasis + ': ' + f.copy.comparisonStatuses[window.comparison.status]
            await expect(article.getByText(basis, { exact: true })).toBeVisible()
            if (source.baseline!.source.kind === 'scan-check' && window.selected && window.evidenceState === 'available') {
              const movement = f.copy.comparisonChange + ': ' + f.copy.comparisonOutcomes[window.comparison.outcome]
              await expect(article.getByText(movement, { exact: true })).toBeVisible()
              const visible = await article.innerText()
              expect(visible.indexOf(basis)).toBeLessThan(visible.indexOf(movement))
            }
            await expect(summary.locator('..')).toHaveJSProperty('open', false)
            await summary.focus(); await page.keyboard.press('Enter')
            await expect(summary).toBeFocused()
            for (const timestamp of [window.startsAt, window.endsAt]) {
              expect(timestamp).toMatch(/\.\d{6}Z$/)
              await expect(article.locator(`time[datetime="${timestamp}"]`).first()).toHaveText(timestamp + ' (UTC)')
            }
            await page.keyboard.press('Enter')
          }
        }
        const details = await readDetails(f.section, f.copy, 2)
        await expect(details.getByText(value.contentHash, { exact: true })).toBeVisible()
        await expect(details.locator('time').first()).toHaveAttribute('datetime', value.evaluatedAt)
        await expect(details.getByText(value.anchor!.id, { exact: true })).toBeVisible()
        const reads = f.state.reads, refresh = f.section.getByRole('button', { name: f.copy.refresh, exact: true })
        await refresh.focus(); await page.keyboard.press('Enter')
        await expect.poll(() => f.state.reads).toBe(reads + 1)
        await expect(f.section).toHaveAttribute('aria-busy', 'false')
        await expect(refresh).toBeFocused()
        await expect(f.section.locator('[aria-live="polite"]')).toHaveText(f.copy.loaded)
      })
    }
    for (const profile of ['unavailable-scan', 'limited-scan', 'diagnostic-heavy'] as const) {
      test(`PR3 ${profile} isolates Scan and retains the frozen Pulse sibling ${lang}`, async ({ page }, info) => {
        const shot = profile === 'unavailable-scan' && lang === 'en' || profile === 'diagnostic-heavy' && lang === 'zh-HK'
        const f = await nodeFixture(page, lang, 'v2Mixed', { profile, ...(shot ? { width: lang === 'en' ? 1440 : 390, dark: lang === 'zh-HK' } : {}) })
        const value = multi(f.value), cards = sourcesIn(f.section)
        await expect(cards).toHaveCount(3); await expect(f.section.getByRole('alert')).toHaveCount(0)
        const pulse = cards.nth(1)
        await expect(pulse.getByText(f.copy.sme.pulseUnranked, { exact: true })).toBeVisible()
        await expect(pulse.getByRole('article')).toHaveCount(3)
        for (const index of [0, 2]) {
          const first = cards.nth(index).getByRole('article').first()
          await expect(first.getByText(f.copy.evidenceStates[value.sources[index].windows[0].evidenceState], { exact: true }).first()).toBeVisible()
          await expect(first.locator('p:visible').filter({ hasText: exactText(f.copy.comparisonChange + ': ' + f.copy.comparisonOutcomes.improved) })).toHaveCount(0)
        }
        if (shot) await populatedShot(page, info, `c9f-pr3-${profile}-${lang}-${lang === 'en' ? '1440-light' : '390-dark'}`)
        if (profile === 'diagnostic-heavy') {
          expect(value.sources.map(source => source.diagnostics.length)).toEqual([134, 133, 133])
          let occurrences = 0
          for (const [index, source] of value.sources.entries()) {
            const summary = cards.nth(index).locator('summary').filter({ hasText: exactText(f.copy.v2.retainedReferences.replace('{count}', String(source.diagnostics.length))) })
            const details = summary.locator('..')
            await expect(details).toHaveJSProperty('open', false)
            await summary.focus(); await page.keyboard.press('Enter')
            await expect(details.locator(':scope > ul > li')).toHaveCount(source.diagnostics.length)
            await expect(details.getByText(source.diagnostics[0].source.id, { exact: false }).first()).toBeVisible()
            occurrences += source.diagnostics.length
            await page.keyboard.press('Enter')
          }
          expect(occurrences).toBe(400)
        }
        await outcomeQuality(page, f.section)
      })
    }
    for (const kind of malformedKinds) {
      test(`PR3 forged V2 ${kind} clears the WHOLE package then GET retry succeeds ${lang}`, async ({ page }) => {
        const f = await nodeFixture(page, lang, 'v2Mixed')
        await expect(sourcesIn(f.section)).toHaveCount(3)
        f.state.value = malformedWire(multi(f.data.values['mature-d7'][kind === 'diagnostics401' ? 'diagnostic-heavy' : 'stored']), kind)
        await f.refresh()
        await expect(f.section.getByRole('alert')).toHaveText(f.copy.sme.multiSourceUnavailable)
        await expect(sourcesIn(f.section)).toHaveCount(0); await expect(f.section.getByRole('article')).toHaveCount(0)
        await expect(f.section.locator('details')).toHaveCount(0)
        f.state.value = f.value
        await f.section.getByRole('button', { name: f.copy.retry, exact: true }).click()
        await expect(sourcesIn(f.section)).toHaveCount(3); await expect(f.section.getByRole('alert')).toHaveCount(0)
        expect(f.state.reads).toBe(3)
      })
    }
    for (const failure of ['401', '403', '503', 'network'] as const) {
      test(`PR3 visible V2 ${failure} clears every source and retries GET only ${lang}`, async ({ page }) => {
        const f = await nodeFixture(page, lang, 'v2Mixed')
        await readDetails(f.section, f.copy, 2)
        f.state.hook = route => failure === 'network' ? route.abort('failed') : route.fulfill({ status: Number(failure), json: { error: 'Controlled read failure' } })
        await f.refresh()
        await expect(f.section.getByRole('alert')).toHaveText(failure === '401' ? f.copy.unauthenticated : failure === '403' ? f.copy.denied : f.copy.sme.multiSourceUnavailable)
        await expect(sourcesIn(f.section)).toHaveCount(0); await expect(f.section.locator('details')).toHaveCount(0)
        f.state.hook = null
        await f.section.getByRole('button', { name: f.copy.retry, exact: true }).click()
        await expect(sourcesIn(f.section)).toHaveCount(3)
        await expect(f.section.locator('[aria-live="polite"]')).toHaveText(f.copy.loaded)
        expect(f.state.reads).toBe(3)
      })
    }
    for (const context of ['hash', 'schema', 'viewer'] as const) for (const barrier of ['transport', 'body'] as const) {
      test(`PR3 direct child ${context} render fence rejects late uncancellable ${barrier} (NOT history) ${lang}`, async ({ page }) => {
        const f = await nodeFixture(page, lang, 'ctxV2', { clock: 'early' })
        const target = context === 'hash' ? packet(lang, 'ctxV2Alt') : context === 'schema' ? packet(lang, 'ctxV1') : f.data
        expect(target.props.initialVersion!.id).toBe(f.props.initialVersion!.id)
        if (context !== 'viewer') expect(target.props.initialVersion!.contentHash).not.toBe(f.props.initialVersion!.contentHash)
        const targetProps = structuredClone(target.props)
        if (context === 'viewer') targetProps.outcomeViewerKey = f.data.viewerKeys.reviewer
        expect(f.data.viewerKeys.reviewer).not.toBe(f.props.outcomeViewerKey)
        const stale = f.value
        let held: Route | undefined
        if (barrier === 'transport') f.state.hook = async route => {
          if (!held) held = route
          else await route.fulfill({ json: f.state.value })
        }
        else await page.evaluate(() => { (window as typeof window & { c9fReadProbe: ReadProbe }).c9fReadProbe.holdBody = true })
        await f.refresh()
        if (barrier === 'transport') await expect.poll(() => Boolean(held)).toBe(true)
        else await page.waitForFunction(() => (window as typeof window & { c9fReadProbe: ReadProbe }).c9fReadProbe.bodyEntered === 1)
        // Repopulate A while the prior A read stays held. The context switch
        // below therefore starts from ACTUALLY VISIBLE cards and open details.
        await f.refresh(); await expect(sourcesIn(f.section)).toHaveCount(3)
        await readDetails(f.section, f.copy, 2)
        f.state.value = target.values['mature-d7'].stored
        const committed = await committedContext(page, targetProps, f.copy.title)
        expect(committed.articles).toBe(0); expect(committed.details).toBe(0); expect(committed.busy).toBe('true')
        expect(committed.text).not.toContain(f.props.initialVersion!.contentHash)
        const expected = target.values['mature-d7'].stored
        await expect(f.section.getByRole('article')).toHaveCount(expected.schemaVersion === 2 ? expected.sources.length * 3 : expected.windows.length)
        const details = await readDetails(f.section, f.copy, expected.schemaVersion)
        await expect(details.getByText(expected.contentHash, { exact: true })).toBeVisible()
        await expect(details.locator('time').first()).toHaveAttribute('datetime', expected.evaluatedAt)
        if (barrier === 'transport') {
          const response = page.waitForResponse(reply => reply.headers()['x-c9f-late'] === '1')
          await held!.fulfill({ headers: { 'X-C9F-Late': '1' }, json: stale }); await response
        } else {
          await page.evaluate(() => (window as typeof window & { c9fReadProbe: ReadProbe }).c9fReadProbe.releaseBody!())
          await page.waitForFunction(() => (window as typeof window & { c9fReadProbe: ReadProbe }).c9fReadProbe.bodyReleased === 1)
        }
        await nextPaint(page)
        await expect(f.section).toHaveAttribute('aria-busy', 'false')
        await expect(details.locator('time').first()).toHaveAttribute('datetime', expected.evaluatedAt)
        await expect(details.getByText(expected.contentHash, { exact: true })).toBeVisible()
        expect(f.state.reads).toBe(4)
      })
    }
    test(`PR3 paired flushSync child updates cancel a scheduled zero-delay read ${lang}`, async ({ page }) => {
      const f = await nodeFixture(page, lang, 'ctxV2', { clock: 'early' }), alternate = packet(lang, 'ctxV2Alt')
      const final = { ...structuredClone(f.props), outcomeViewerKey: f.data.viewerKeys.reviewer }
      f.state.value = f.data.values['mature-d7'].stored
      const before = f.state.reads
      const snapshots = await page.evaluate(({ first, final, title }) => {
        const counts: number[] = []
        for (const props of [first, final]) {
          window.dispatchEvent(new CustomEvent('fixture-delivery-scope', { detail: props }))
          const section = Array.from(document.querySelectorAll('section[aria-label]')).find(element => element.getAttribute('aria-label') === title)!
          counts.push(section.querySelectorAll('article').length)
        }
        return counts
      }, { first: alternate.props, final, title: f.copy.title })
      expect(snapshots).toEqual([0, 0])
      await expect(sourcesIn(f.section)).toHaveCount(3); await nextPaint(page)
      expect(f.state.reads).toBe(before + 1)
      await expect(f.section.getByRole('alert')).toHaveCount(0)
    })
    test(`PR3 equivalent fresh decision and selected objects do not refetch ${lang}`, async ({ page }) => {
      const f = await nodeFixture(page, lang, 'ctxV2'), before = f.state.reads
      expect(f.props.initialVersion!.decision).not.toBeNull()
      const equivalent = structuredClone(f.props)
      const committed = await committedContext(page, equivalent, f.copy.title)
      expect(committed.articles).toBe(9); expect(committed.busy).toBe('false')
      await nextPaint(page); expect(f.state.reads).toBe(before)
      await expect(f.section.locator('[aria-live="polite"]')).toHaveText(f.copy.loaded)
    })
    test(`PR3 controlled invalid selected hash clears data without starting GET ${lang}`, async ({ page }) => {
      const f = await nodeFixture(page, lang, 'ctxV2'), invalid = structuredClone(f.props), before = f.state.reads
      invalid.initialVersion!.contentHash = 'invalid-selected-hash'
      const committed = await committedContext(page, invalid, f.copy.title)
      expect(committed.articles).toBe(0); expect(committed.details).toBe(0)
      await expect(f.section.getByRole('alert')).toHaveText(f.copy.sme.multiSourceUnavailable)
      await f.section.getByRole('button', { name: f.copy.retry, exact: true }).click()
      await nextPaint(page); expect(f.state.reads).toBe(before)
      await committedContext(page, f.props, f.copy.title)
      await expect(sourcesIn(f.section)).toHaveCount(3)
      expect(f.state.reads).toBe(before + 1)
    })
    for (const variant of ['v2Mixed', 'v2Single'] as const) for (const dark of [false, true]) for (const width of [320, 390, 768, 1440]) {
      test(`PR3 populated ${variant} layout ${lang} ${dark ? 'dark' : 'light'} ${width}`, async ({ page }, info) => {
        const f = await nodeFixture(page, lang, variant, { width, dark })
        await expect(sourcesIn(f.section)).toHaveCount(variant === 'v2Mixed' ? 3 : 1)
        await expect(f.section.getByRole('article')).toHaveCount(variant === 'v2Mixed' ? 9 : 3)
        await expect(f.section.locator('details[open]')).toHaveCount(0)
        await outcomeQuality(page, f.section)
        const capture = lang === 'en' && width === 1440 && !dark || lang === 'zh-HK' && width === 390 && dark
        if (capture) await populatedShot(page, info, `c9f-pr3-${variant}-${lang}-${width}-${dark ? 'dark' : 'light'}`)
        const first = sourcesIn(f.section).first().getByRole('article').first().locator('summary')
        await first.focus(); await page.keyboard.press('Enter'); await expect(first).toBeFocused()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      })
    }
  }
})
