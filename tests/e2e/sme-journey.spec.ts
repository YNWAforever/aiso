import { test, expect, devices, type Browser, type BrowserContext, type Page, type Route, type TestInfo } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'
import { JourneyMemory } from '../../__tests__/sme-journey/transport'
import type { JourneyActor, JourneyKind, JourneyReply, JourneyRequest, JourneyScenario } from '../../__tests__/sme-journey/types'
import type { MultiSourceOutcomeResponse } from '../../lib/outcomes/multi-source'
import type { WorkItem } from '../../lib/work-items/schema'
import type { VersionDetail } from '../../lib/change-sets/types'

test.setTimeout(60_000)
test.use({ serviceWorkers: 'block', contextOptions: { reducedMotion: 'reduce', timezoneId: 'UTC' } })
const origin = 'https://journey.fixture'
type NodeJourneyFactory = Pick<typeof import('../../__tests__/sme-journey/scenario.node'), 'createJourneyCallbacks' | 'projectJourneyOutcomes'>
function files(lang: 'en' | 'zh-HK', kind: JourneyKind = 'v1-scan') {
  const dir = process.env.C9J_HTML_DIR, css = process.env.C9J_CSS_PATH
  if (!dir || !css) throw Error('C9J real renderer and build CSS are required')
  const prefix = kind === 'v2-mixed' ? lang : `${lang}-${kind}`
  const scenario = JSON.parse(readFileSync(join(dir, `${prefix}-scenario.json`), 'utf8')) as JourneyScenario
  const node = createRequire(resolve('package.json'))(resolve(dir, 'scenario-freezer.cjs')) as NodeJourneyFactory
  const copy = JSON.parse(readFileSync(join(dir, `${lang}-journey-copy.json`), 'utf8')) as Record<string, string>
  expect(scenario.kind).toBe(kind)
  return { dir, prefix, copy, css: readFileSync(css, 'utf8'), scenario, node, bundle: readFileSync(join(dir, 'fixture.js'), 'utf8') }
}
async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
}
async function openSummary(page: Page, text: string) {
  const summary = page.locator('summary').filter({ hasText: text })
  if (!await summary.evaluate(element => (element.parentElement as HTMLDetailsElement).open)) {
    await summary.focus()
    await expect(summary).toBeFocused()
    await page.keyboard.press('Enter')
  }
}
async function outcomeRegion(page: Page, messages: typeof en | typeof zh) {
  await openSummary(page, messages.changeSets.sme.downstream)
  const region = page.getByRole('region', { name: messages.outcomes.title, exact: true })
  await expect(region).toHaveAttribute('aria-busy', 'false')
  return region
}
async function refreshOutcomes(page: Page, messages: typeof en | typeof zh) {
  const region = await outcomeRegion(page, messages)
  await region.getByRole('button', { name: messages.outcomes.refresh, exact: true }).click()
  await expect(region).toHaveAttribute('aria-busy', 'false')
  await expect(region.getByRole('alert')).toHaveCount(0)
  return region
}
async function outcomeIdentity(page: Page, messages: typeof en | typeof zh, version: VersionDetail, anchor: string | null) {
  const region = await outcomeRegion(page, messages)
  await openSummary(page, messages.outcomes.v2.readDetails)
  await expect(region.getByText(version.id, { exact: true })).toBeVisible()
  await expect(region.getByText(version.contentHash, { exact: true })).toBeVisible()
  if (anchor) await expect(region.getByText(`${messages.outcomes.anchorId}: ${anchor}`, { exact: true })).toBeVisible()
  return region
}
async function v2Outcomes(page: Page, scenario: JourneyScenario, version: VersionDetail, anchor: string, mature = false) {
  const messages = scenario.lang === 'en' ? en : zh, m = messages.outcomes
  const region = await outcomeIdentity(page, messages, version, anchor)
  await expect(region.getByText(`${m.sme.anchorState}: ${m.sme.anchorStates.active}`, { exact: true })).toBeVisible()
  await expect(region.getByRole('article')).toHaveCount(scenario.kind === 'v2-mixed' ? 9 : 3)
  const cards = region.locator('section[aria-labelledby]')
  await expect(cards).toHaveCount(scenario.kind === 'v2-mixed' ? 3 : 1)
  if (mature) {
    for (const index of scenario.kind === 'v2-mixed' ? [0, 2] : [0]) {
      const d7 = cards.nth(index).getByRole('article').first()
      await expect(d7.getByText(`${m.comparisonBasis}: ${m.comparisonStatuses.partially_comparable}`, { exact: true })).toBeVisible()
      await expect(d7.getByText(`${m.comparisonChange}: ${m.comparisonOutcomes.improved}`, { exact: true })).toBeVisible()
      await expect(d7.getByText(m.provisional, { exact: true })).toHaveCount(0)
      const limitation = d7.getByRole('listitem').filter({ hasText: m.reasons['final-path-identity-withheld'] })
      await expect(limitation).toHaveCount(1)
      await expect(limitation).toHaveText(m.reasons['final-path-identity-withheld'])
      await expect(limitation).toBeVisible()
    }
  } else {
    for (const article of await region.getByRole('article').all()) await expect(article.getByText(m.timeStates['not-due'], { exact: true })).toBeVisible()
  }
  if (scenario.kind === 'v2-mixed') {
    const pulse = cards.nth(1)
    await expect(pulse.getByText(m.sme.pulseUnranked, { exact: true })).toBeVisible()
    await expect(pulse.getByText(`${m.comparisonChange}: ${m.comparisonOutcomes.improved}`, { exact: true })).toHaveCount(0)
    await expect(cards.nth(0).getByRole('heading', { level: 3 })).toContainText(m.v2.sourceNumber.replace('{number}', '1'))
    await expect(cards.nth(2).getByRole('heading', { level: 3 })).toContainText(m.v2.sourceNumber.replace('{number}', '3'))
  }
  return region
}
type HeldOutcome = { reply: JourneyReply; request: JourneyRequest; release: () => Promise<void> }
async function completedBodies(page: Page, path: string, anchorId: string) {
  return page.evaluate(({ path, anchorId }) => (window as typeof window & { c9jCompletedOutcomes: { path: string; anchorId: string | null }[] }).c9jCompletedOutcomes
    .filter(row => row.path === path && row.anchorId === anchorId).length, { path, anchorId })
}
async function releaseCompletedBody(page: Page, held: HeldOutcome, anchorId: string) {
  const before = await completedBodies(page, held.request.path, anchorId)
  await held.release()
  await expect.poll(() => completedBodies(page, held.request.path, anchorId)).toBeGreaterThan(before)
  await settle(page)
}

async function quality(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  for (const control of await page.locator('button:visible, summary:visible, select:visible').all()) {
    expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  }
}
async function savedOutcomes(page: Page, scenario: JourneyScenario, version: VersionDetail, eventId: string) {
  const m = (scenario.lang === 'en' ? en : zh).outcomes
  const region = page.getByRole('region', { name: m.title, exact: true })
  await expect(region).toHaveAttribute('aria-busy', 'false')
  await expect(region.getByRole('alert')).toHaveCount(0)
  await expect(region.getByText(`${m.sme.anchorState}: ${m.sme.anchorStates.active}`, { exact: true })).toBeVisible()
  await expect(region.getByText(m.sme.anchorLimitation, { exact: true })).toBeVisible()
  const windows = region.getByRole('article')
  await expect(windows).toHaveCount(3)
  for (const window of await windows.all()) {
    await expect(window.getByText(`${m.timeState}: ${m.timeStates['not-due']}`, { exact: true })).toBeVisible()
    await expect(window.getByText(m.sme.noSelectedEvidence, { exact: true })).toBeVisible()
  }
  const technical = region.locator('summary').filter({ hasText: m.sme.technicalDetails })
  await technical.click()
  await expect(region.getByText(version.id, { exact: true })).toBeVisible()
  await expect(region.getByText(version.contentHash, { exact: true })).toBeVisible()
  await expect(region.getByText(eventId, { exact: true })).toBeVisible()
  await technical.click()
}
async function ready(page: Page) { await page.waitForFunction(() => Boolean((window as Window & { journeyFixtureReady?: boolean }).journeyFixtureReady)) }
async function fixture(page: Page, browser: Browser, info: TestInfo, lang: 'en' | 'zh-HK', width = 390, dark = false, kind: JourneyKind = 'v1-scan', uncancellableOutcomes = false) {
  const assets = files(lang, kind), frozenDrafts: WorkItem[] = [], errors: string[] = [], unexpected: string[] = [], expectedFailedUrls = new Set<string>()
  const callbacks = assets.node.createJourneyCallbacks(assets.scenario)
  const memory = new JourneyMemory(assets.scenario, { ...callbacks, freeze: (draft, number, review, submittedAt) => {
    frozenDrafts.push(structuredClone(draft)); return callbacks.freeze!(draft, number, review, submittedAt)
  } })
  const httpRequests: JourneyRequest[] = []
  const failures = { decisionAck: false, withdrawalAck: false, beforeDeliveryCommit: false }
  const holds: { actor: JourneyActor; versionId: string; captured: (value: HeldOutcome) => void }[] = []
  const pendingReleases = new Set<() => void>(), pendingCompletions: Promise<void>[] = []
  function holdNextOutcome(actor: JourneyActor, versionId: string) {
    return new Promise<HeldOutcome>(captured => holds.push({ actor, versionId, captured }))
  }
  async function holdReply(route: Route, request: JourneyRequest, reply: JourneyReply) {
    const index = holds.findIndex(hold => hold.actor === request.actor && request.method === 'GET' && request.path.endsWith(`/versions/${hold.versionId}/outcomes`))
    if (index < 0) return false
    const [hold] = holds.splice(index, 1)
    let release!: () => void, completed!: () => void
    const gate = new Promise<void>(resolveGate => { release = resolveGate })
    const done = new Promise<void>(resolveDone => { completed = resolveDone })
    pendingReleases.add(release); pendingCompletions.push(done)
    const captured = structuredClone(reply)
    hold.captured({ reply: captured, request: structuredClone(request), release: async () => { release(); await done } })
    try { await gate; await route.fulfill({ status: captured.status, json: captured.body, headers: captured.headers }) }
    finally { pendingReleases.delete(release); completed() }
    return true
  }
  const base = `/${lang}/dashboard/${assets.scenario.ids.clientId}`, review = `${base}/work-items/${assets.scenario.ids.itemId}/versions`
  async function install(context: BrowserContext, actor: JourneyActor) {
    if (uncancellableOutcomes) await context.addInitScript(() => {
      const native = window.fetch.bind(window)
      const scope = window as typeof window & { c9jCompletedOutcomes: { path: string; anchorId: string | null }[] }
      scope.c9jCompletedOutcomes = []
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (/\/outcomes$/.test(url)) {
          const options = { ...init }; delete options.signal
          const response = await native(input, options), decode = response.json.bind(response)
          response.json = async () => {
            const raw: unknown = await decode(), value = raw as { anchor?: { id?: unknown } | null } | null
            scope.c9jCompletedOutcomes.push({ path: url, anchorId: typeof value?.anchor?.id === 'string' ? value.anchor.id : null })
            return raw
          }
          return response
        }
        return native(input, init)
      }
    })
    await context.addInitScript(value => { document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.toggle('dark', value)) }, dark)
    await context.routeWebSocket('**/*', socket => { unexpected.push('WebSocket ' + socket.url()); socket.close() })
    context.on('page', current => { current.on('pageerror', error => errors.push(error.message)); current.on('console', message => { if (message.type() === 'error' && !expectedFailedUrls.has(message.location().url)) errors.push(message.text()) }) })
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin) { unexpected.push(request.url()); await route.abort(); return }
      if (url.pathname.startsWith('/api/')) {
        try {
          const input: JourneyRequest = { actor, method: request.method(), path: url.pathname + url.search, ...(request.postData() ? { body: request.postDataJSON() as unknown } : {}) }
          httpRequests.push(structuredClone(input))
          if (failures.beforeDeliveryCommit && input.method === 'POST' && /\/delivery$/.test(input.path)) {
            failures.beforeDeliveryCommit = false; expectedFailedUrls.add(request.url()); await route.abort('failed'); return
          }
          const reply = memory.request(input)
          if (reply.status === 503) expectedFailedUrls.add(request.url())
          if (reply.status === 201 && input.method === 'POST' && ((failures.decisionAck && /\/decision$/.test(input.path)) || (failures.withdrawalAck && /\/withdraw$/.test(input.path)))) {
            if (input.path.endsWith('/decision')) failures.decisionAck = false
            else failures.withdrawalAck = false
            expectedFailedUrls.add(request.url()); await route.abort('failed'); return
          }
          if (await holdReply(route, input, reply)) return
          await route.fulfill({ status: reply.status, json: reply.body, headers: reply.headers })
        } catch (failure) {
          if (failure instanceof Error && failure.message === 'SAMPLE_ACK_LOST_AFTER_COMMIT') expectedFailedUrls.add(request.url())
          else errors.push(String(failure))
          await route.abort('failed')
        }
        return
      }
      let name: string | null = null
      if (request.method() === 'GET' && url.pathname === base && !url.search) name = 'today'
      if (request.method() === 'GET' && url.pathname === base + '/opportunities' && url.searchParams.get('draft') === assets.scenario.ids.itemId && [...url.searchParams.keys()].length === 1) name = 'draft'
      if (request.method() === 'GET' && url.pathname === review && !url.search) name = !memory.versions.length ? 'owner-prepare' : actor === 'reviewer' && memory.stage === 'pending' ? 'reviewer-pending' : 'owner-' + memory.stage
      if (!name) { unexpected.push(request.url()); await route.abort(); return }
      const html = readFileSync(join(assets.dir, `${assets.prefix}-${name}.html`), 'utf8')
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${lang}" class="${dark ? 'dark' : ''}" style="--font-inter:Arial"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Controlled journey</title><style>${assets.css}</style></head><body>${html}<script>${assets.bundle}</script></body></html>` })
    })
  }
  // Existing owner page predates the context listener.
  page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error' && !expectedFailedUrls.has(message.location().url)) errors.push(message.text()) })
  await page.setViewportSize({ width, height: 900 }); await install(page.context(), 'owner')
  const reviewerContext = await browser.newContext({ ...(info.project.name === 'mobile' ? devices['Pixel 5'] : {}), viewport: { width, height: 900 }, reducedMotion: 'reduce', timezoneId: 'UTC', serviceWorkers: 'block' })
  await install(reviewerContext, 'reviewer')
  const messages = lang === 'en' ? en : zh
  async function capture(stage: string) {
    if (info.project.name === 'chromium' && ((lang === 'en' && width === 1440 && !dark) || (lang === 'zh-HK' && width === 390 && dark))) {
      await page.screenshot({ path: info.outputPath(`journey-${lang}-${stage}.png`), fullPage: true })
    }
  }
  async function prepare() {
    await page.goto(origin + base); await ready(page); await capture('today')
    const link = page.locator(`a[href="${base}/opportunities?draft=${assets.scenario.ids.itemId}"]`)
    await expect(link).toBeVisible(); await link.focus(); await expect(link).toBeFocused(); await page.keyboard.press('Enter')
    await ready(page); await expect(page.getByLabel(messages.opportunities.notes, { exact: true })).toHaveValue(assets.scenario.draft.notes)
    await page.getByLabel(messages.opportunities.notes, { exact: true }).fill(assets.scenario.canonicalDrafts[1].notes)
    await page.getByRole('button', { name: messages.opportunities.saveChanges, exact: true }).click()
    await expect(page.getByText(messages.opportunities.changesSaved, { exact: true })).toBeVisible(); await capture('draft')
    const next = page.getByRole('link', { name: messages.opportunities.sme.prepareReview, exact: true })
    await next.focus(); await expect(next).toBeFocused(); await page.keyboard.press('Enter'); await ready(page)
    await page.getByRole('button', { name: messages.changeSets.submitVersion, exact: true }).click()
    await expect(page.getByRole('heading', { name: messages.changeSets.sme.wait, exact: true })).toBeVisible()
    expect(frozenDrafts).toHaveLength(1); expect(frozenDrafts[0]).toEqual(memory.draft)
    expect(memory.versions[0].contentHash).toBe(assets.scenario.canonicalVersions[1].contentHash)
  }
  async function approve() {
    const reviewer = await reviewerContext.newPage()
    await reviewer.goto(origin + review); await ready(reviewer)
    await reviewer.getByLabel(messages.changeSets.decision, { exact: true }).selectOption('approved')
    await reviewer.getByLabel(messages.changeSets.reason, { exact: true }).fill(lang === 'en' ? 'Reviewed the saved sample evidence.' : '已查看儲存嘅示例證據。')
    await reviewer.getByRole('button', { name: messages.changeSets.recordDecision, exact: true }).click()
    await expect(reviewer.getByRole('heading', { name: messages.changeSets.sme.approved, exact: true })).toBeVisible()
    await page.getByRole('button', { name: messages.changeSets.reloadHistory, exact: true }).click()
    await expect(page.getByRole('heading', { name: messages.changeSets.sme.approved, exact: true })).toBeVisible()
    expect(memory.versions[0].submittedBy.profileId).not.toBe(memory.versions[0].decision?.decidedBy.profileId)
    return reviewer
  }
  async function fillDelivery(target = page, deliveredAt = assets.scenario.deliveredAt, note = 'Recorded in this controlled sample only.') {
    await openSummary(target, messages.changeSets.sme.manualPath)
    await expect(target.getByRole('button', { name: messages.delivery.record, exact: true })).toBeEnabled()
    await target.getByLabel(messages.delivery.destination, { exact: true }).fill('Sample product page')
    await target.getByLabel(messages.delivery.timeUtc, { exact: true }).fill(deliveredAt.slice(0, 16))
    await target.getByLabel(messages.delivery.note, { exact: true }).fill(note)
  }
  async function finish() {
    for (const release of pendingReleases) release()
    await Promise.allSettled(pendingCompletions)
    await reviewerContext.close()
    expect(errors).toEqual([]); expect(unexpected).toEqual([]); expect(memory.unexpected).toEqual([])
    expect(memory.requests.filter(request => /export|handoff|live-check|scan|pulse|invite/.test(request.path))).toEqual([])
  }
  return { ...assets, memory, frozenDrafts, base, review, messages, prepare, approve, fillDelivery, capture, finish, reviewerContext, holdNextOutcome, httpRequests, failures }
}
type JourneyFixture = Awaited<ReturnType<typeof fixture>>
const outcomePath = (f: JourneyFixture, version: VersionDetail) => `/api/clients/${f.scenario.ids.clientId}/work-items/${f.scenario.ids.itemId}/versions/${version.id}/outcomes`
const outcomeReads = (f: JourneyFixture, actor?: JourneyActor) => f.memory.requests.filter(request => request.method === 'GET' && request.path.endsWith('/outcomes') && (!actor || request.actor === actor)).length
const posts = (f: JourneyFixture, suffix: string) => f.httpRequests.filter(request => request.method === 'POST' && request.path.endsWith(suffix))
async function selectHistory(page: Page, f: JourneyFixture, version: VersionDetail, actor: JourneyActor) {
  const label = f.messages.changeSets.versionNumber.replace('{number}', String(version.versionNumber)) + ' · ' + f.messages.changeSets[version.decision?.decision ?? 'pending']
  const path = outcomePath(f, version).replace(/\/outcomes$/, '')
  const before = f.memory.requests.filter(request => request.actor === actor && request.method === 'GET' && request.path === path).length
  const button = page.getByRole('button', { name: label, exact: true })
  await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true')
  expect(f.memory.requests.filter(request => request.actor === actor && request.method === 'GET' && request.path === path).length).toBeGreaterThan(before)
}
function approvalSnapshot(f: JourneyFixture, version: VersionDetail) {
  const snapshot = f.memory.outcomeSnapshot(version.id)
  expect(snapshot.decisionRowId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  for (const row of snapshot.events) expect(row.approvalDecisionId).toBe(row.event.kind === 'attest' ? snapshot.decisionRowId : null)
  return snapshot
}
async function declareDelivery(page: Page, f: JourneyFixture, deliveredAt = f.scenario.deliveredAt) {
  await f.fillDelivery(page, deliveredAt)
  const count = f.memory.events.length
  await page.getByRole('button', { name: f.messages.delivery.record, exact: true }).click()
  await expect.poll(() => f.memory.events.length).toBe(count + 1)
  await expect(page.getByText(f.messages.delivery.recorded, { exact: true })).toBeVisible()
}
async function assertDeliveryFields(page: Page, f: JourneyFixture) {
  await expect(page.getByLabel(f.messages.delivery.destination, { exact: true })).toHaveValue('Sample product page')
  await expect(page.getByLabel(f.messages.delivery.timeUtc, { exact: true })).toHaveValue(f.scenario.deliveredAt.slice(0, 16))
  await expect(page.getByLabel(f.messages.delivery.note, { exact: true })).toHaveValue('Recorded in this controlled sample only.')
}
for (const lang of ['en', 'zh-HK'] as const) {
  for (const dark of [false, true]) for (const width of [320, 390, 768, 1440]) test(`SME continuous saved work ${lang} ${width} ${dark ? 'dark' : 'light'}`, async ({ page, browser }, info) => {
    const f = await fixture(page, browser, info, lang, width, dark)
    try {
      await f.prepare(); await quality(page)
      const reviewer = await f.approve(); await quality(reviewer)
      await f.fillDelivery()
      const outcomePath = `/api/clients/${f.scenario.ids.clientId}/work-items/${f.scenario.ids.itemId}/versions/${f.memory.versions[0].id}/outcomes`
      const outcomeReads = () => f.memory.requests.filter(request => request.method === 'GET' && request.path === outcomePath).length
      const beforeDeliveryReads = outcomeReads()
      await page.getByRole('button', { name: f.messages.delivery.record, exact: true }).click()
      await expect.poll(() => f.memory.events.length).toBe(1)
      await expect(page.getByText(f.messages.delivery.recorded, { exact: true })).toBeVisible()
      expect(f.memory.active?.provenance).toBe('self_reported'); expect(f.memory.stage).toBe('delivered')
      await savedOutcomes(page, f.scenario, f.memory.versions[0], f.memory.active!.eventId)
      expect(outcomeReads()).toBeGreaterThan(beforeDeliveryReads)
      await quality(page); await f.capture('delivery')
      const beforeReloadReads = outcomeReads()
      await page.reload(); await ready(page)
      await savedOutcomes(page, f.scenario, f.memory.versions[0], f.memory.active!.eventId)
      expect(outcomeReads()).toBeGreaterThan(beforeReloadReads)
      expect(f.memory.versions).toHaveLength(1); expect(f.memory.events).toHaveLength(1)
      await expect(page.getByRole('heading', { name: f.messages.changeSets.sme.approved, exact: true })).toBeVisible()
    } finally { await f.finish() }
  })
  test(`SME continuous member read failure stays unknown and recovers ${lang}`, async ({ page, browser }, info) => {
    const f = await fixture(page, browser, info, lang)
    try {
      await f.prepare(); f.memory.failNext = 'members'
      await page.getByText(f.messages.changeSets.reviewHelp.title, { exact: true }).click()
      await expect(page.getByText(f.messages.changeSets.reviewHelp.unknown, { exact: true })).toBeVisible()
      await page.getByRole('button', { name: f.messages.changeSets.reviewHelp.retry, exact: true }).click()
      await expect(page.getByText(f.messages.changeSets.reviewHelp.other, { exact: true })).toBeVisible()
      expect(f.memory.versions[0].decision).toBeNull()
      expect(await page.getByRole('button', { name: f.messages.changeSets.recordDecision, exact: true }).count()).toBe(0)
    } finally { await f.finish() }
  })
  test(`SME continuous lost delivery acknowledgement preserves input and reconciles ${lang}`, async ({ page, browser }, info) => {
    const f = await fixture(page, browser, info, lang)
    try {
      await f.prepare(); await f.approve(); await f.fillDelivery(); f.memory.loseNextDeliveryReply = true
      await page.getByRole('button', { name: f.messages.delivery.record, exact: true }).click()
      await expect(page.getByLabel(f.messages.delivery.destination, { exact: true })).toHaveValue('Sample product page')
      await expect(page.getByText(f.messages.delivery.unavailable, { exact: true })).toBeVisible()
      expect(f.memory.events).toHaveLength(1)
      await page.getByRole('button', { name: f.messages.delivery.refresh, exact: true }).click()
      await expect(page.getByRole('button', { name: f.messages.delivery.record, exact: true })).toBeDisabled()
      expect(f.memory.events).toHaveLength(1)
      await expect(page.getByLabel(f.messages.delivery.note, { exact: true })).toHaveValue('Recorded in this controlled sample only.')
    } finally { await f.finish() }
  })
  test(`SME standalone sample is offline and resettable ${lang}`, async ({ page }) => {
    const assets = files(lang), network: string[] = [], errors: string[] = []
    page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()) })
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(pathToFileURL(resolve(assets.dir, `${assets.prefix}-preview.html`)).href); await ready(page)
    const copy = lang === 'en' ? { reset: 'Reset sample', actor: 'Demo actor view', title: 'Controlled SME sample' } : { reset: '重設示例', actor: '示例角色畫面', title: '受控中小企示例' }
    await expect(page.getByRole('heading', { name: copy.title, exact: true })).toBeVisible()
    const m = lang === 'en' ? en : zh, base = `/${lang}/dashboard/${assets.scenario.ids.clientId}`
    await page.locator(`a[href="${base}/opportunities?draft=${assets.scenario.ids.itemId}"]`).click()
    await expect(page.getByLabel(m.opportunities.notes, { exact: true })).toHaveValue(assets.scenario.draft.notes)
    await page.getByRole('link', { name: m.opportunities.sme.prepareReview, exact: true }).click()
    await page.getByRole('button', { name: m.changeSets.submitVersion, exact: true }).click()
    await expect(page.getByRole('heading', { name: m.changeSets.sme.wait, exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: copy.actor, exact: true }).selectOption('reviewer')
    await page.getByLabel(m.changeSets.decision, { exact: true }).selectOption('approved')
    await page.getByLabel(m.changeSets.reason, { exact: true }).fill('Checked the supplied sample evidence.')
    await page.getByRole('button', { name: m.changeSets.recordDecision, exact: true }).click()
    await expect(page.getByRole('heading', { name: m.changeSets.sme.approved, exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: copy.actor, exact: true }).selectOption('owner')
    await page.locator('summary').filter({ hasText: m.changeSets.sme.manualPath }).click()
    await page.getByLabel(m.delivery.destination, { exact: true }).fill('Sample product page')
    await page.getByLabel(m.delivery.timeUtc, { exact: true }).fill(assets.scenario.deliveredAt.slice(0, 16))
    await page.getByLabel(m.delivery.note, { exact: true }).fill('Offline sample declaration only.')
    await page.getByRole('button', { name: m.delivery.record, exact: true }).click()
    await expect(page.getByText(m.delivery.recorded, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: m.delivery.record, exact: true })).toBeDisabled()
    await savedOutcomes(page, assets.scenario, assets.scenario.canonicalVersions[0], assets.scenario.ids.attestationId)
    await quality(page)
    await page.getByRole('button', { name: copy.reset, exact: true }).click()
    await expect(page.getByRole('combobox', { name: copy.actor, exact: true })).toHaveValue('owner')
    await quality(page); expect(network).toEqual([]); expect(errors).toEqual([])
  })
}

// New cases are explicit V2. The 22 legacy source cases above keep explicit V1 assets.
for (const lang of ['en', 'zh-HK'] as const) {
  for (const dark of [false, true]) for (const width of [320, 390, 768, 1440]) test(`SME V2 mixed continuous saved work ${lang} ${width} ${dark ? 'dark' : 'light'}`, async ({ page, browser }, info) => {
    const f = await fixture(page, browser, info, lang, width, dark, 'v2-mixed')
    try {
      await f.prepare(); expect(f.memory.versions[0].schemaVersion).toBe(2)
      await quality(page)
      const reviewer = await f.approve(); await quality(reviewer)
      await declareDelivery(page, f)
      const version = f.memory.versions[0], anchor = f.memory.active!.eventId
      await v2Outcomes(page, f.scenario, version, anchor)
      f.memory.setClock('mature-d7')
      await refreshOutcomes(page, f.messages)
      const region = await v2Outcomes(page, f.scenario, version, anchor, true)
      await expect(region.locator(`time[datetime="${f.memory.clock}"]`)).toBeVisible()
      await refreshOutcomes(reviewer, f.messages)
      await v2Outcomes(reviewer, f.scenario, version, anchor, true)
      expect(f.memory.requests.some(request => request.actor === 'owner' && request.path === outcomePath(f, version))).toBe(true)
      expect(f.memory.requests.some(request => request.actor === 'reviewer' && request.path === outcomePath(f, version))).toBe(true)
      const state = approvalSnapshot(f, version)
      expect(state.events).toHaveLength(1)
      const projected = f.node.projectJourneyOutcomes(f.scenario, state) as MultiSourceOutcomeResponse
      expect(projected.sources[0].windows[0]).toMatchObject({ provisional: false, comparison: { outcome: 'improved', baselineVerdict: 'warn', observedVerdict: 'pass', status: 'partially_comparable' } })
      await quality(page); await f.capture('v2-mature')
    } finally { await f.finish() }
  })

  test(`SME V2 one frozen source stays schema two ${lang}`, async ({ page, browser }, info) => {
    const f = await fixture(page, browser, info, lang, 390, false, 'v2-one-scan')
    try {
      await f.prepare(); await f.approve(); await declareDelivery(page, f)
      const version = f.memory.versions[0]
      expect(version.schemaVersion).toBe(2)
      if (version.schemaVersion !== 2) throw Error('Expected explicit V2')
      expect(version.evidenceSnapshots).toHaveLength(1)
      f.memory.setClock('mature-d7'); await refreshOutcomes(page, f.messages)
      const region = await v2Outcomes(page, f.scenario, version, f.memory.active!.eventId, true)
      await expect(region.getByText(/stored-outcomes\.v1/)).toHaveCount(0)
      await expect(region.getByText(/stored-outcomes\.v2/)).toBeVisible()
      await quality(page)
    } finally { await f.finish() }
  })

  test(`SME V2 saved-record profiles isolate sources and disclose the actual 400 occurrence bound ${lang}`, async ({ page, browser }, info) => {
    const f = await fixture(page, browser, info, lang, 390, false, 'v2-mixed')
    try {
      await f.prepare(); await f.approve(); await declareDelivery(page, f)
      f.memory.setClock('mature-d7')
      for (const profile of ['stored', 'unavailable-scan', 'limited-scan', 'diagnostic-heavy'] as const) {
        f.memory.setObservationProfile(profile); await refreshOutcomes(page, f.messages)
        const region = await outcomeRegion(page, f.messages), cards = region.locator('section[aria-labelledby]'), m = f.messages.outcomes
        await expect(cards).toHaveCount(3)
        await expect(cards.nth(1).getByText(m.sme.pulseUnranked, { exact: true })).toBeVisible()
        const actual = f.node.projectJourneyOutcomes(f.scenario, f.memory.outcomeSnapshot(f.memory.versions[0].id)) as MultiSourceOutcomeResponse
        if (profile === 'stored') await v2Outcomes(page, f.scenario, f.memory.versions[0], f.memory.active!.eventId, true)
        if (profile === 'unavailable-scan') {
          for (const index of [0, 2]) await expect(cards.nth(index).getByRole('article').first().getByText(m.evidenceStates.unavailable, { exact: true })).toBeVisible()
          expect(actual.sources[1].reasons).not.toContain('source-unavailable')
        }
        if (profile === 'limited-scan') {
          for (const index of [0, 2]) await expect(cards.nth(index).getByText(m.reasons['candidate-limit-exceeded'], { exact: true }).first()).toBeVisible()
          await expect(cards.nth(1).getByText(m.reasons['candidate-limit-exceeded'], { exact: true })).toHaveCount(0)
          expect(actual.sources[0].truncated).toBe(true); expect(actual.sources[1].truncated).toBe(false)
        }
        if (profile === 'diagnostic-heavy') {
          expect(actual.sources.map(source => source.diagnostics.length)).toEqual([134, 133, 133])
          for (const card of await cards.all()) {
            await expect(card.getByText(m.v2.reasons['diagnostic-limit-exceeded'], { exact: true }).first()).toBeVisible()
            await card.locator('summary').filter({ hasText: m.v2.retainedReferences.split('{count}')[0] }).click()
          }
          await expect(region.locator('li.rounded.border.border-border.p-3')).toHaveCount(400)
          await expect(cards.first().getByText(m.v2.diagnosticBudget, { exact: true })).toBeVisible()
          await quality(page)
        }
      }
    } finally { await f.finish() }
  })
}

for (const lang of ['en', 'zh-HK'] as const) {
  test(`SME V2 committed decision acknowledgement keeps the actual UI retry identity across outcomes ${lang}`, async ({ page, browser }, info) => {
    const f = await fixture(page, browser, info, lang, 390, false, 'v2-mixed')
    try {
      await f.prepare()
      const reviewer = await f.reviewerContext.newPage()
      await reviewer.goto(origin + f.review); await ready(reviewer); await outcomeRegion(reviewer, f.messages)
      const reason = lang === 'en' ? 'Keep this exact independent-review reason.' : '保留呢段獨立審批原因。'
      await reviewer.getByLabel(f.messages.changeSets.decision, { exact: true }).selectOption('approved')
      await reviewer.getByLabel(f.messages.changeSets.reason, { exact: true }).fill(reason)
      f.failures.decisionAck = true
      const beforeCommitReads = outcomeReads(f, 'reviewer')
      await reviewer.getByRole('button', { name: f.messages.changeSets.recordDecision, exact: true }).click()
      await expect(reviewer.getByText(f.messages.changeSets.unavailable, { exact: true })).toBeVisible()
      const version = f.memory.versions[0], committed = approvalSnapshot(f, version).decisionRowId
      expect(version.decision?.reason).toBe(reason)
      const first = posts(f, '/decision').at(-1)!
      await settle(reviewer); expect(outcomeReads(f, 'reviewer')).toBe(beforeCommitReads)
      f.memory.setClock('mature-d7'); f.memory.setObservationProfile('diagnostic-heavy')
      await refreshOutcomes(reviewer, f.messages)
      await expect(reviewer.getByLabel(f.messages.changeSets.decision, { exact: true })).toHaveValue('approved')
      await expect(reviewer.getByLabel(f.messages.changeSets.reason, { exact: true })).toHaveValue(reason)
      const beforeRetryReads = outcomeReads(f, 'reviewer')
      await reviewer.getByRole('button', { name: f.messages.changeSets.recordDecision, exact: true }).click()
      await expect(reviewer.getByRole('heading', { name: f.messages.changeSets.sme.approved, exact: true })).toBeVisible()
      expect(posts(f, '/decision')).toHaveLength(2)
      expect(posts(f, '/decision')[1].body).toEqual(first.body)
      expect(approvalSnapshot(f, version).decisionRowId).toBe(committed)
      expect(committed).not.toBe((first.body as { requestId: string }).requestId)
      await settle(reviewer); expect(outcomeReads(f, 'reviewer')).toBe(beforeRetryReads)
      expect(f.memory.events).toEqual([])
      const beforeOwnerReads = outcomeReads(f, 'owner')
      await page.getByRole('button', { name: f.messages.changeSets.reloadHistory, exact: true }).click()
      await expect(page.getByRole('heading', { name: f.messages.changeSets.sme.approved, exact: true })).toBeVisible()
      await settle(page); expect(outcomeReads(f, 'owner')).toBe(beforeOwnerReads)
    } finally { await f.finish() }
  })

  test(`SME V2 uncommitted delivery failure retries the same UI operation after a real authority read ${lang}`, async ({ page, browser }, info) => {
    const f = await fixture(page, browser, info, lang, 390, false, 'v2-mixed')
    try {
      await f.prepare(); await f.approve(); await f.fillDelivery()
      f.failures.beforeDeliveryCommit = true
      await page.getByRole('button', { name: f.messages.delivery.record, exact: true }).click()
      await expect(page.getByText(f.messages.delivery.unavailable, { exact: true })).toBeVisible()
      expect(f.memory.events).toEqual([])
      const first = posts(f, '/delivery').at(-1)!
      f.memory.setClock('mature-d7'); await refreshOutcomes(page, f.messages)
      await assertDeliveryFields(page, f)
      await expect(page.getByRole('button', { name: f.messages.delivery.record, exact: true })).toBeDisabled()
      expect(posts(f, '/delivery')).toHaveLength(1)
      await page.getByRole('button', { name: f.messages.delivery.refresh, exact: true }).click()
      await expect(page.getByRole('button', { name: f.messages.delivery.record, exact: true })).toBeEnabled()
      await assertDeliveryFields(page, f)
      await page.getByRole('button', { name: f.messages.delivery.record, exact: true }).click()
      await expect(page.getByText(f.messages.delivery.recorded, { exact: true })).toBeVisible()
      expect(posts(f, '/delivery')).toHaveLength(2)
      expect(posts(f, '/delivery')[1].body).toEqual(first.body)
      expect(f.memory.events).toHaveLength(1)
      expect(f.memory.requests.filter(request => request.method === 'POST' && request.path.endsWith('/delivery'))).toHaveLength(1)
      approvalSnapshot(f, f.memory.versions[0])
      await v2Outcomes(page, f.scenario, f.memory.versions[0], f.memory.active!.eventId, true)
    } finally { await f.finish() }
  })

  test(`SME V2 committed delivery and withdrawal acknowledgements preserve fields without reauthorizing from outcomes ${lang}`, async ({ page, browser }, info) => {
    const f = await fixture(page, browser, info, lang, 390, false, 'v2-mixed')
    try {
      await f.prepare(); await f.approve(); await f.fillDelivery()
      f.memory.loseNextDeliveryReply = true
      await page.getByRole('button', { name: f.messages.delivery.record, exact: true }).click()
      await expect(page.getByText(f.messages.delivery.unavailable, { exact: true })).toBeVisible()
      const version = f.memory.versions[0], committed = approvalSnapshot(f, version), operation = posts(f, '/delivery').at(-1)!
      expect(committed.events).toHaveLength(1)
      f.memory.setClock('mature-d7'); await refreshOutcomes(page, f.messages)
      await assertDeliveryFields(page, f)
      await expect(page.getByRole('button', { name: f.messages.delivery.record, exact: true })).toBeDisabled()
      expect(posts(f, '/delivery')).toHaveLength(1)
      // Explicit Node replay witness, not a fabricated browser click through disabled authority.
      expect(f.memory.request(operation).status).toBe(200)
      expect(f.memory.events).toHaveLength(1)
      expect(approvalSnapshot(f, version).decisionRowId).toBe(committed.decisionRowId)
      expect(approvalSnapshot(f, version).events).toEqual(committed.events)
      await page.getByRole('button', { name: f.messages.delivery.refresh, exact: true }).click()
      await expect(page.getByText(f.messages.delivery.sme.active, { exact: true })).toBeVisible()
      await assertDeliveryFields(page, f)
      await page.getByRole('button', { name: f.messages.delivery.sme.withdraw, exact: true }).click()
      const reason = 'Retain this exact withdrawal reason through the read.'
      await page.getByLabel(f.messages.delivery.withdrawReason, { exact: true }).fill(reason)
      f.failures.withdrawalAck = true
      await page.getByRole('button', { name: f.messages.delivery.confirmWithdraw, exact: true }).click()
      await expect(page.getByText(f.messages.delivery.unavailable, { exact: true })).toBeVisible()
      const withdraw = posts(f, '/withdraw').at(-1)!
      expect(f.memory.events).toHaveLength(2)
      await refreshOutcomes(page, f.messages)
      await expect(page.getByLabel(f.messages.delivery.withdrawReason, { exact: true })).toHaveValue(reason)
      await expect(page.getByRole('button', { name: f.messages.delivery.confirmWithdraw, exact: true })).toBeDisabled()
      await assertDeliveryFields(page, f)
      expect(posts(f, '/withdraw')).toHaveLength(1)
      expect(f.memory.request(withdraw).status).toBe(200)
      expect(f.memory.events).toHaveLength(2)
      expect(approvalSnapshot(f, version).decisionRowId).toBe(committed.decisionRowId)
      await page.getByRole('button', { name: f.messages.delivery.refresh, exact: true }).click()
      await expect(page.getByText(f.messages.delivery.noActive, { exact: true })).toBeVisible()
      const region = await outcomeRegion(page, f.messages)
      await expect(region.getByRole('article')).toHaveCount(0)
      await expect(region.getByText(`${f.messages.outcomes.sme.anchorState}: ${f.messages.outcomes.sme.anchorStates.withdrawn}`, { exact: true })).toBeVisible()
    } finally { await f.finish() }
  })
}

for (const lang of ['en', 'zh-HK'] as const) {
  test(`SME V2 genuine second submission and history GETs fence uncancellable owner and reviewer reads ${lang}`, async ({ page, browser }, info) => {
    const f = await fixture(page, browser, info, lang, 390, false, 'v2-mixed', true)
    try {
      await f.prepare(); const reviewer = await f.approve(); await declareDelivery(page, f)
      const first = f.memory.versions[0], firstAnchor = f.memory.active!.eventId, firstDecision = approvalSnapshot(f, first).decisionRowId
      await v2Outcomes(page, f.scenario, first, firstAnchor)
      await refreshOutcomes(reviewer, f.messages); await v2Outcomes(reviewer, f.scenario, first, firstAnchor)
      const ownerHold = f.holdNextOutcome('owner', first.id), reviewerHold = f.holdNextOutcome('reviewer', first.id)
      await page.getByRole('region', { name: f.messages.outcomes.title, exact: true }).getByRole('button', { name: f.messages.outcomes.refresh, exact: true }).click()
      await reviewer.getByRole('region', { name: f.messages.outcomes.title, exact: true }).getByRole('button', { name: f.messages.outcomes.refresh, exact: true }).click()
      const oldOwner = await ownerHold, oldReviewer = await reviewerHold
      expect((oldOwner.reply.body as MultiSourceOutcomeResponse).anchor?.id).toBe(firstAnchor)
      expect((oldReviewer.reply.body as MultiSourceOutcomeResponse).contentHash).toBe(first.contentHash)
      // A separate actual editor page leaves both inspectors and their pending reads alive.
      const editor = await page.context().newPage()
      await editor.goto(origin + f.base + `/opportunities?draft=${f.scenario.ids.itemId}`); await ready(editor)
      const changedNotes = f.memory.draft.notes + '\nGenuine second saved submission, not a canonical alternative.'
      await editor.getByLabel(f.messages.opportunities.notes, { exact: true }).fill(changedNotes)
      await editor.getByRole('button', { name: f.messages.opportunities.saveChanges, exact: true }).click()
      await expect(editor.getByText(f.messages.opportunities.changesSaved, { exact: true })).toBeVisible()
      await openSummary(page, f.messages.changeSets.sme.savedDraft)
      await page.getByRole('button', { name: f.messages.changeSets.reloadDraft, exact: true }).click()
      await page.getByRole('button', { name: f.messages.changeSets.submitVersion, exact: true }).click()
      await expect.poll(() => f.memory.versions.length).toBe(2)
      const second = f.memory.versions[0]
      expect(second.versionNumber).toBe(2); expect(second.id).not.toBe(first.id); expect(second.contentHash).not.toBe(first.contentHash)
      expect(second.notes).toBe(changedNotes); expect(f.frozenDrafts).toHaveLength(2)
      expect(f.frozenDrafts[1]).toEqual(f.memory.draft)
      expect(second.submittedAt).toBe(f.memory.clock)
      await reviewer.getByRole('button', { name: f.messages.changeSets.reloadHistory, exact: true }).click()
      await selectHistory(reviewer, f, second, 'reviewer')
      await reviewer.getByLabel(f.messages.changeSets.decision, { exact: true }).selectOption('approved')
      await reviewer.getByLabel(f.messages.changeSets.reason, { exact: true }).fill('Independently reviewed genuine version two.')
      await reviewer.getByRole('button', { name: f.messages.changeSets.recordDecision, exact: true }).click()
      await expect(reviewer.getByRole('heading', { name: f.messages.changeSets.sme.approved, exact: true })).toBeVisible()
      const secondDecision = approvalSnapshot(f, second).decisionRowId
      expect(secondDecision).not.toBe(firstDecision)
      await page.getByRole('button', { name: f.messages.changeSets.reloadHistory, exact: true }).click()
      await expect(page.getByRole('heading', { name: f.messages.changeSets.sme.approved, exact: true })).toBeVisible()
      await declareDelivery(page, f, f.memory.clock)
      const secondAnchor = f.memory.active!.eventId
      expect(secondAnchor).not.toBe(firstAnchor)
      await outcomeIdentity(page, f.messages, second, secondAnchor)
      await refreshOutcomes(reviewer, f.messages); await outcomeIdentity(reviewer, f.messages, second, secondAnchor)
      await releaseCompletedBody(page, oldOwner, firstAnchor)
      await releaseCompletedBody(reviewer, oldReviewer, firstAnchor)
      for (const current of [page, reviewer]) {
        const region = await outcomeIdentity(current, f.messages, second, secondAnchor)
        await expect(region.getByText(first.contentHash, { exact: true })).toHaveCount(0)
        await expect(region.getByText(firstAnchor, { exact: true })).toHaveCount(0)
      }
      expect(approvalSnapshot(f, first).decisionRowId).toBe(firstDecision)
      expect(approvalSnapshot(f, second).events[0].approvalDecisionId).toBe(secondDecision)
      await selectHistory(page, f, first, 'owner')
      await outcomeIdentity(page, f.messages, first, firstAnchor)
      await openSummary(page, f.messages.changeSets.sme.manualPath)
      await page.getByRole('button', { name: f.messages.delivery.sme.withdraw, exact: true }).click()
      await page.getByLabel(f.messages.delivery.withdrawReason, { exact: true }).fill('Withdraw only the historical version declaration.')
      await page.getByRole('button', { name: f.messages.delivery.confirmWithdraw, exact: true }).click()
      await expect(page.getByText(f.messages.delivery.withdrawalRecorded, { exact: true })).toBeVisible()
      await expect((await outcomeRegion(page, f.messages)).getByRole('article')).toHaveCount(0)
      const oldState = approvalSnapshot(f, first), newState = approvalSnapshot(f, second)
      expect(oldState.events).toHaveLength(2); expect(newState.events).toHaveLength(1)
      expect(oldState.decisionRowId).toBe(firstDecision); expect(newState.decisionRowId).toBe(secondDecision)
      await selectHistory(page, f, second, 'owner')
      await outcomeIdentity(page, f.messages, second, secondAnchor)
      await editor.close(); await quality(page)
    } finally { await f.finish() }
  })

  test(`SME V2 withdrawn and replacement anchors reject a late uncancellable old-anchor reply ${lang}`, async ({ page, browser }, info) => {
    const f = await fixture(page, browser, info, lang, 390, false, 'v2-mixed', true)
    try {
      await f.prepare(); await f.approve(); await declareDelivery(page, f)
      const version = f.memory.versions[0], originalAnchor = f.memory.active!.eventId, decision = approvalSnapshot(f, version).decisionRowId
      f.memory.setClock('mature-d7'); await refreshOutcomes(page, f.messages)
      const held = f.holdNextOutcome('owner', version.id)
      await page.getByRole('region', { name: f.messages.outcomes.title, exact: true }).getByRole('button', { name: f.messages.outcomes.refresh, exact: true }).click()
      const old = await held
      expect((old.reply.body as MultiSourceOutcomeResponse).anchor?.id).toBe(originalAnchor)
      await page.getByRole('button', { name: f.messages.delivery.sme.withdraw, exact: true }).click()
      const reason = 'Preserve this withdrawal reason while reading saved outcomes.'
      await page.getByLabel(f.messages.delivery.withdrawReason, { exact: true }).fill(reason)
      // A newer actual read must not clear the dirty withdrawal form or wait for the old reply.
      const region = page.getByRole('region', { name: f.messages.outcomes.title, exact: true })
      await region.getByRole('button', { name: f.messages.outcomes.refresh, exact: true }).click()
      await expect(region).toHaveAttribute('aria-busy', 'false')
      await expect(page.getByLabel(f.messages.delivery.withdrawReason, { exact: true })).toHaveValue(reason)
      await page.getByRole('button', { name: f.messages.delivery.confirmWithdraw, exact: true }).click()
      await expect(page.getByText(f.messages.delivery.withdrawalRecorded, { exact: true })).toBeVisible()
      await expect((await outcomeRegion(page, f.messages)).getByRole('article')).toHaveCount(0)
      await declareDelivery(page, f)
      const replacement = f.memory.active!.eventId
      expect(replacement).not.toBe(originalAnchor)
      await v2Outcomes(page, f.scenario, version, replacement, true)
      const actual = approvalSnapshot(f, version)
      expect(actual.events).toHaveLength(3); expect(actual.decisionRowId).toBe(decision)
      await releaseCompletedBody(page, old, originalAnchor)
      const current = await outcomeIdentity(page, f.messages, version, replacement)
      await expect(current.getByText(originalAnchor, { exact: true })).toHaveCount(0)
      expect((f.node.projectJourneyOutcomes(f.scenario, actual) as MultiSourceOutcomeResponse).anchor?.id).toBe(replacement)
      await quality(page)
    } finally { await f.finish() }
  })
}

async function countOfflineOutcomeReads(page: Page) {
  return page.evaluate(() => (window as typeof window & { c9jOutcomeReads: string[] }).c9jOutcomeReads.length)
}
for (const lang of ['en', 'zh-HK'] as const) for (const kind of ['v2-mixed', 'v2-one-scan'] as const) {
  test(`SME V2 standalone clock and records preserve mounted dirty forms without HTTP ${lang} ${kind}`, async ({ page }) => {
    const assets = files(lang, kind), m = lang === 'en' ? en : zh, copy = assets.copy, network: string[] = [], sockets: string[] = [], errors: string[] = []
    await page.setViewportSize({ width: 390, height: 900 })
    page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()) })
    page.on('websocket', socket => sockets.push(socket.url()))
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto(pathToFileURL(resolve(assets.dir, `${assets.prefix}-preview.html`)).href); await ready(page)
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute('content', /connect-src 'none'/)
    await expect(page.getByRole('heading', { name: copy.title, exact: true })).toBeVisible()
    await expect(page.getByText(`${copy.sampleKind}: ${kind === 'v2-mixed' ? copy.mixedKind : copy.oneScanKind}`, { exact: true })).toBeVisible()
    // Count production outcome fetch calls AFTER the standalone transport has installed.
    // These go through the actual in-tab memory, not a native HTTP fallback.
    await page.evaluate(() => {
      const scope = window as typeof window & { c9jOutcomeReads: string[] }, controlled = window.fetch.bind(window)
      scope.c9jOutcomeReads = []
      window.fetch = (input, init) => {
        const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (path.endsWith('/outcomes')) scope.c9jOutcomeReads.push(path)
        return controlled(input, init)
      }
    })
    const base = `/${lang}/dashboard/${assets.scenario.ids.clientId}`
    await page.locator(`a[href="${base}/opportunities?draft=${assets.scenario.ids.itemId}"]`).click()
    await page.getByLabel(m.opportunities.notes, { exact: true }).fill(assets.scenario.canonicalDrafts[1].notes)
    await page.getByRole('button', { name: m.opportunities.saveChanges, exact: true }).click()
    await expect(page.getByText(m.opportunities.changesSaved, { exact: true })).toBeVisible()
    await page.getByRole('link', { name: m.opportunities.sme.prepareReview, exact: true }).click()
    await page.getByRole('button', { name: m.changeSets.submitVersion, exact: true }).click()
    await expect(page.getByRole('heading', { name: m.changeSets.sme.wait, exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: copy.actor, exact: true }).selectOption('reviewer')
    await page.getByLabel(m.changeSets.decision, { exact: true }).selectOption('approved')
    const reason = 'Keep this typed decision while changing saved-record controls.'
    const reasonField = page.getByLabel(m.changeSets.reason, { exact: true })
    await reasonField.fill(reason)
    const reasonNode = await reasonField.elementHandle()
    await outcomeRegion(page, m)
    const beforeProfile = await countOfflineOutcomeReads(page)
    await page.getByRole('combobox', { name: copy.observationProfile, exact: true }).selectOption('diagnostic-heavy')
    await settle(page)
    expect(await countOfflineOutcomeReads(page)).toBe(beforeProfile)
    expect(await reasonNode!.evaluate(element => element.isConnected)).toBe(true)
    await expect(reasonField).toHaveValue(reason)
    await expect(page.getByLabel(m.changeSets.decision, { exact: true })).toHaveValue('approved')
    await refreshOutcomes(page, m)
    expect(await countOfflineOutcomeReads(page)).toBe(beforeProfile + 1)
    await expect(reasonField).toHaveValue(reason)
    await page.getByRole('button', { name: m.changeSets.recordDecision, exact: true }).click()
    await expect(page.getByRole('heading', { name: m.changeSets.sme.approved, exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: copy.actor, exact: true }).selectOption('owner')
    await openSummary(page, m.changeSets.sme.manualPath)
    await expect(page.getByRole('button', { name: m.delivery.record, exact: true })).toBeEnabled()
    await page.getByLabel(m.delivery.destination, { exact: true }).fill('Offline sample product page')
    await page.getByLabel(m.delivery.timeUtc, { exact: true }).fill(assets.scenario.deliveredAt.slice(0, 16))
    const note = 'Preserve this local declaration across clock and record choices.'
    await page.getByLabel(m.delivery.note, { exact: true }).fill(note)
    const noteNode = await page.getByLabel(m.delivery.note, { exact: true }).elementHandle()
    await outcomeRegion(page, m)
    const beforeClock = await countOfflineOutcomeReads(page)
    await page.getByRole('button', { name: copy.advanceTime, exact: true }).click()
    await page.getByRole('combobox', { name: copy.observationProfile, exact: true }).selectOption('stored')
    await settle(page)
    expect(await countOfflineOutcomeReads(page)).toBe(beforeClock)
    await expect(page.getByRole('button', { name: copy.advanceTime, exact: true })).toBeDisabled()
    await expect(page.locator(`time[datetime="${assets.scenario.clocks['mature-d7']}"]`)).toBeVisible()
    expect(await noteNode!.evaluate(element => element.isConnected)).toBe(true)
    await expect(page.getByLabel(m.delivery.destination, { exact: true })).toHaveValue('Offline sample product page')
    await expect(page.getByLabel(m.delivery.timeUtc, { exact: true })).toHaveValue(assets.scenario.deliveredAt.slice(0, 16))
    await expect(page.getByLabel(m.delivery.note, { exact: true })).toHaveValue(note)
    await refreshOutcomes(page, m)
    expect(await countOfflineOutcomeReads(page)).toBe(beforeClock + 1)
    expect(await noteNode!.evaluate(element => element.isConnected)).toBe(true)
    await expect(page.getByLabel(m.delivery.note, { exact: true })).toHaveValue(note)
    await page.getByRole('button', { name: m.delivery.record, exact: true }).click()
    await expect(page.getByText(m.delivery.recorded, { exact: true })).toBeVisible()
    await v2Outcomes(page, assets.scenario, assets.scenario.canonicalVersions[1], assets.scenario.ids.attestationId, true)
    await page.getByRole('combobox', { name: copy.observationProfile, exact: true }).selectOption('unavailable-scan')
    await refreshOutcomes(page, m)
    const cards = (await outcomeRegion(page, m)).locator('section[aria-labelledby]')
    await expect(cards.first().getByRole('article').first().getByText(m.outcomes.evidenceStates.unavailable, { exact: true })).toBeVisible()
    await quality(page)
    await page.getByRole('button', { name: copy.reset, exact: true }).click()
    await expect(page.getByRole('combobox', { name: copy.actor, exact: true })).toHaveValue('owner')
    await expect(page.getByRole('combobox', { name: copy.observationProfile, exact: true })).toHaveValue('stored')
    await expect(page.getByRole('button', { name: copy.advanceTime, exact: true })).toBeEnabled()
    await expect(page.locator(`time[datetime="${assets.scenario.clock}"]`)).toBeVisible()
    await expect(page.getByRole('region', { name: m.outcomes.title, exact: true })).toHaveCount(0)
    await quality(page)
    expect(network).toEqual([]); expect(sockets).toEqual([]); expect(errors).toEqual([])
  })
}
