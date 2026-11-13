import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'

const clientId = '11111111-1111-4111-8111-111111111111'
const runId = '22222222-2222-4222-8222-222222222222'
const endpoint = `/api/dashboard/clients/${clientId}/pulse-runs`
async function fixture(page: Page, lang: string, dark = false) {
  const dir = process.env.AISO_FIRST_PULSE_HTML_DIR
  if (!dir) throw new Error('First monitoring component fixtures are required')
  const css = readFileSync(`${dir}/build.css`, 'utf8'), js = readFileSync(`${dir}/fixture.js`, 'utf8')
  const c = (lang === 'en' ? en : zh).runProgress.sme
  await page.route('**/*', route => route.abort())
  await page.route(`https://guided.fixture/${lang}*`, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${lang}"${dark ? ' class="dark"' : ''}><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Monitoring fixture</title><style>${css}</style></head><body><main><h1>${c.title}</h1><div id="root"></div></main><script>${js}</script></body></html>` }))
}
for (const lang of ['en', 'zh-HK']) for (const width of [320, 390, 768, 1440]) for (const dark of [false, true]) {
  test(`guided monitoring confirms spend and recovers saved progress ${lang} ${width} ${dark ? 'dark' : 'light'}`, async ({ page }) => {
    const copy = (lang === 'en' ? en : zh).runProgress, c = copy.sme
    await page.setViewportSize({ width, height: 900 })
    await fixture(page, lang, dark)
    let saved: Record<string, unknown> | null = null, loseReply = true
    const writes: Record<string, unknown>[] = []
    const options = () => ({ prompts: 2, variants: 5, expected: 10, remaining: 20, contextConfirmed: true, enabled: true, week: '2026-11-09', currentCanonicalId: saved ? runId : null, latest: saved, legacyCurrentWeek: false, legacyObservationIds: [], search: { requested: 'off' } })
    await page.route(`**${endpoint}`, route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: options() })
      writes.push(route.request().postDataJSON())
      saved = { id: runId, week: '2026-11-09', purpose: 'canonical', sourceRunId: null, coverage: { expected: 10, succeeded: 10, classified: 10, mentioned: 0, failed: 0, pending: 0, blocked: 0, status: 'completed', coverage: 1, mentionRate: 0 }, reasons: [], retryable: false, classificationRepairIds: [] }
      if (loseReply) { loseReply = false; return route.abort('failed') }
      return route.fulfill({ status: 202, json: { run: saved } })
    })
    await page.route(`**${endpoint}/${runId}`, route => route.fulfill({ json: saved }))
    await page.goto(`https://guided.fixture/${lang}?sme=1`)
    const card = page.locator('#first-monitoring')
    const start = card.getByRole('button', { name: c.start, exact: true })
    await start.click()
    await expect(card.locator('section[tabindex="-1"]')).toBeFocused()
    await expect(card.getByText(copy.cost, { exact: true }).first()).toBeVisible()
    await expect(card.getByText('Example brand', { exact: true }).last()).toBeVisible()
    expect(writes).toHaveLength(0)
    await card.getByRole('button', { name: c.cancel, exact: true }).click()
    await expect(start).toBeFocused()
    expect(writes).toHaveLength(0)
    await start.click()
    await card.getByRole('button', { name: c.confirm, exact: true }).click()
    await expect(card.getByRole('alert')).toBeVisible()
    expect(writes).toHaveLength(1)
    expect(writes[0].kind).toBe('initial')
    // Reconcile the lost acknowledgement through GET; do not repeat paid work.
    await card.getByRole('button', { name: copy.refresh, exact: true }).click()
    await expect(card.getByRole('link', { name: c.viewAnswers, exact: true })).toHaveAttribute('href', new RegExp(`run=${runId}&week=2026-11-09`))
    expect(writes).toHaveLength(1)
    await expect(card.getByRole('button', { name: copy.retest, exact: true })).not.toBeVisible()
    await expect(card.getByRole('button', { name: c.start, exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await card.locator('summary').click()
    await expect(card.getByRole('button', { name: copy.retest, exact: true })).toBeVisible()
    await card.getByRole('button', { name: copy.retest, exact: true }).click()
    await expect(card.getByRole('heading', { name: c.confirmTitle })).toBeVisible()
    await card.getByRole('button', { name: c.cancel, exact: true }).click()
    expect(writes).toHaveLength(1)
  })
}

for (const lang of ['en', 'zh-HK']) {
  for (const state of ['session', 'plan', 'outage', 'invalid'] as const) test(`guided monitoring read ${state} stays unavailable ${lang}`, async ({ page }) => {
    const copy = (lang === 'en' ? en : zh).runProgress, c = copy.sme
    await fixture(page, lang)
    let writes = 0
    await page.route(`**${endpoint}`, route => {
      if (route.request().method() !== 'GET') writes++
      return route.fulfill({ status: state === 'session' ? 401 : state === 'plan' ? 403 : state === 'outage' ? 503 : 200, json: {} })
    })
    await page.goto(`https://guided.fixture/${lang}?sme=1`)
    const card = page.locator('#first-monitoring')
    await expect(card.getByRole('alert')).toContainText(state === 'session' ? c.signInRequired : state === 'plan' ? c.planRequired : copy.unavailable)
    await expect(card.getByRole('button', { name: c.start, exact: true })).toHaveCount(0)
    if (state === 'plan') await expect(card.getByRole('link', { name: c.viewPlans })).toHaveAttribute('href', `/${lang}/pricing`)
    if (state === 'session') await expect(card.getByRole('link', { name: c.signIn })).toHaveAttribute('href', `/${lang}/auth/login`)
    expect(writes).toBe(0)
  })
  test(`saved classification repair stays scoped while collection is paused ${lang}`, async ({ page }) => {
    const copy = (lang === 'en' ? en : zh).runProgress, c = copy.sme
    await fixture(page, lang)
    const ids = Array.from({ length: 8 }, (_, i) => `33333333-3333-4333-8333-${String(i + 1).padStart(12, '0')}`)
    let repaired = false
    const requests: Record<string, unknown>[] = []
    const saved = () => ({ id: runId, week: '2026-11-09', purpose: 'canonical', reasons: repaired ? [] : ['classification_pending'], retryable: false, classificationRepairIds: repaired ? [] : ids, coverage: { expected: 40, succeeded: 40, classified: repaired ? 40 : 32, mentioned: 0, failed: 0, pending: 0, blocked: 0, status: repaired ? 'completed' : 'partial' } })
    await page.route(`**${endpoint}`, route => route.request().method() !== 'GET' ? route.abort() : route.fulfill({ json: { prompts: 8, variants: 5, expected: 40, remaining: 10, contextConfirmed: true, enabled: false, week: '2026-11-09', currentCanonicalId: runId, latest: saved(), legacyObservationIds: [], search: { requested: 'off' } } }))
    await page.route(`**${endpoint}/legacy-repair`, route => {
      requests.push(route.request().postDataJSON()); repaired = true
      return route.fulfill({ json: { classified: 8, unchanged: 0, failed: 0 } })
    })
    await page.goto(`https://guided.fixture/${lang}?sme=1`)
    const card = page.locator('#first-monitoring')
    await expect(card.getByText(c.paused, { exact: true }).first()).toBeVisible()
    await card.locator('summary').click()
    await card.getByRole('button', { name: copy.repairSaved, exact: true }).click()
    expect(requests).toHaveLength(0)
    await card.locator('section[tabindex="-1"]').press('Escape')
    await expect(card.getByRole('button', { name: copy.repairSaved, exact: true })).toBeFocused()
    await card.getByRole('button', { name: copy.repairSaved, exact: true }).click()
    await card.getByRole('button', { name: c.confirm, exact: true }).click()
    await expect(card.getByText(copy.repairOutcome.replace('{classified}', '8').replace('{unchanged}', '0').replace('{failed}', '0'), { exact: true })).toBeVisible()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ runId, observationIds: ids })
    await expect(card.getByRole('button', { name: copy.retest, exact: true })).toBeDisabled()
  })
  for (const explicit of [false, true]) test(`guided monitoring preserves ${explicit ? 'explicit saved' : 'current canonical'} scope over newest retest ${lang}`, async ({ page }) => {
    const c = (lang === 'en' ? en : zh).runProgress.sme
    await fixture(page, lang)
    const newest = '44444444-4444-4444-8444-444444444444', selected = '55555555-5555-4555-8555-555555555555'
    const data = (id: string, week: string, purpose = 'canonical') => ({ id, week, purpose, reasons: [], retryable: false, classificationRepairIds: [], coverage: { expected: 5, succeeded: 5, classified: 5, mentioned: 0, failed: 0, pending: 0, blocked: 0, status: 'completed' } })
    const reads: string[] = []
    await page.route(`**${endpoint}`, route => route.fulfill({ json: { prompts: 1, variants: 5, expected: 5, remaining: 20, contextConfirmed: true, enabled: true, week: '2026-11-09', currentCanonicalId: runId, latest: data(newest, '2026-11-09', 'retest'), legacyObservationIds: [], search: { requested: 'off' } } }))
    await page.route(`**${endpoint}/*`, route => { const id = route.request().url().split('/').at(-1)!; reads.push(id); return route.fulfill({ json: data(id, id === selected ? '2026-11-02' : '2026-11-09') }) })
    await page.goto(`https://guided.fixture/${lang}?sme=1${explicit ? '&run=' + selected : ''}`)
    const card = page.locator('#first-monitoring')
    await expect(card.getByRole('link', { name: c.viewAnswers, exact: true })).toHaveAttribute('href', `/${lang}/dashboard/${clientId}/observations?run=${explicit ? selected : runId}&week=${explicit ? '2026-11-02' : '2026-11-09'}`)
    expect(reads).toEqual([explicit ? selected : runId])
    await card.locator('summary').click()
    await expect(card.getByRole('link', { name: c.latest, exact: true })).toHaveAttribute('href', new RegExp(`run=${newest}&week=2026-11-09`))
  })
}
