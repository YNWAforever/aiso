import { test, expect, devices, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'
import { JourneyMemory } from '../../__tests__/sme-journey/transport'
import type { JourneyActor, JourneyScenario } from '../../__tests__/sme-journey/types'
import type { WorkItem } from '../../lib/work-items/schema'
import type { VersionDetail } from '../../lib/change-sets/types'

test.setTimeout(60_000)
test.use({ serviceWorkers: 'block', contextOptions: { reducedMotion: 'reduce', timezoneId: 'UTC' } })
const origin = 'https://journey.fixture'
function files(lang: 'en' | 'zh-HK') {
  const dir = process.env.C9J_HTML_DIR, css = process.env.C9J_CSS_PATH
  if (!dir || !css) throw Error('C9J real renderer and build CSS are required')
  const scenario = JSON.parse(readFileSync(join(dir, `${lang}-scenario.json`), 'utf8')) as JourneyScenario
  const node = createRequire(resolve('package.json'))(resolve(dir, 'scenario-freezer.cjs')) as { freezeJourneyDraft: (draft: WorkItem, number: number) => VersionDetail }
  return { dir, css: readFileSync(css, 'utf8'), scenario, node, bundle: readFileSync(join(dir, 'fixture.js'), 'utf8') }
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
async function fixture(page: Page, browser: Browser, info: TestInfo, lang: 'en' | 'zh-HK', width = 390, dark = false) {
  const assets = files(lang), frozenDrafts: WorkItem[] = [], errors: string[] = [], unexpected: string[] = [], expectedFailedUrls = new Set<string>()
  const memory = new JourneyMemory(assets.scenario, { freeze: (draft, number) => { frozenDrafts.push(structuredClone(draft)); return assets.node.freezeJourneyDraft(draft, number) } })
  const base = `/${lang}/dashboard/${assets.scenario.ids.clientId}`, review = `${base}/work-items/${assets.scenario.ids.itemId}/versions`
  async function install(context: BrowserContext, actor: JourneyActor) {
    await context.addInitScript(value => { document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.toggle('dark', value)) }, dark)
    await context.routeWebSocket('**/*', socket => { unexpected.push('WebSocket ' + socket.url()); socket.close() })
    context.on('page', current => { current.on('pageerror', error => errors.push(error.message)); current.on('console', message => { if (message.type() === 'error' && !expectedFailedUrls.has(message.location().url)) errors.push(message.text()) }) })
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin) { unexpected.push(request.url()); await route.abort(); return }
      if (url.pathname.startsWith('/api/')) {
        try {
          const reply = memory.request({ actor, method: request.method(), path: url.pathname + url.search, ...(request.postData() ? { body: request.postDataJSON() as unknown } : {}) })
          if (reply.status === 503) expectedFailedUrls.add(request.url())
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
      const html = readFileSync(join(assets.dir, `${lang}-${name}.html`), 'utf8')
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
  async function fillDelivery() {
    const manual = page.locator('summary').filter({ hasText: messages.changeSets.sme.manualPath })
    await manual.focus(); await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: messages.delivery.record, exact: true })).toBeEnabled()
    await page.getByLabel(messages.delivery.destination, { exact: true }).fill('Sample product page')
    await page.getByLabel(messages.delivery.timeUtc, { exact: true }).fill('2026-11-14T00:10')
    await page.getByLabel(messages.delivery.note, { exact: true }).fill('Recorded in this controlled sample only.')
  }
  async function finish() {
    await reviewerContext.close()
    expect(errors).toEqual([]); expect(unexpected).toEqual([]); expect(memory.unexpected).toEqual([])
    expect(memory.requests.filter(request => /export|handoff|live-check|scan|pulse|invite/.test(request.path))).toEqual([])
  }
  return { ...assets, memory, frozenDrafts, base, review, messages, prepare, approve, fillDelivery, capture, finish }
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
    await page.goto(pathToFileURL(resolve(assets.dir, `${lang}-preview.html`)).href); await ready(page)
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
    await page.getByLabel(m.delivery.timeUtc, { exact: true }).fill('2026-11-14T00:10')
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
