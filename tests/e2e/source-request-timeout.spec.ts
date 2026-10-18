import { test, expect, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { buildSourcePack } from '../../lib/view-models/source-pack'
import type { SourceDto } from '../../lib/sources/schema'
import { sourceClientId, sourcePageFixture } from '../../__tests__/components/source-maintenance-fixtures'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'

const sourceId = '00000000-0000-4000-8000-000000000101'
const versionId = '00000000-0000-4000-8000-000000000102'
const hash = 'a'.repeat(64)
const base = `/api/clients/${sourceClientId}/sources`
const detailPath = `${base}/${sourceId}`
const approvalPath = `${detailPath}/versions/${versionId}/approve`
type Call = { method: string; path: string; body: Record<string, unknown> | null }

async function fixture(page: Page, lang: string) {
  const dir = process.env.AISO_SOURCES_HTML_DIR!, css = process.env.AISO_SOURCES_CSS_PATH!
  if (!dir || !css) throw Error('Isolated source fixtures required')
  const copy = (lang === 'en' ? en : zh).sources
  const source: SourceDto = {
    id: sourceId, sourceKey: 'synthetic-source-3', kind: 'facts', label: 'Isolated source review',
    agentUseAllowed: false, revokedAt: null, latestVersion: 3, freshness: 'current',
    updatedAt: '2026-10-18T00:00:00Z',
    current: { id: versionId, versionNumber: 3, contentHash: hash, importMethod: 'paste',
      originRef: 'Synthetic fixture only', importedAt: '2026-10-18T00:00:00Z',
      approvedAt: null, approvedBy: null,
      entries: [{ question: 'Synthetic source question', answer: 'Retained answer version three.' }] },
  }
  const state = {
    source, calls: [] as Call[], errors: [] as string[],
    hook: null as ((route: Route, call: Call) => Promise<void>) | null,
  }
  page.on('pageerror', error => state.errors.push(error.message))
  await page.route('**/*', route => route.abort())
  await page.route('**/api/clients/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const call = { method: request.method(), path, body: request.postData() ? request.postDataJSON() : null }
    state.calls.push(call)
    if (path === base && call.method === 'GET') {
      return route.fulfill({ json: {
        ...sourcePageFixture(), items: [state.source], sources: [state.source],
        total: 1, nextCursor: null, pack: buildSourcePack([state.source], new Date('2026-10-18T00:00:00Z')),
      } })
    }
    if (state.hook) return state.hook(route, call)
    if (path === detailPath && call.method === 'GET') return route.fulfill({ json: { source: state.source } })
    if (path === detailPath && call.method === 'PATCH') {
      if ('agentUseAllowed' in call.body!) state.source.agentUseAllowed = Boolean(call.body!.agentUseAllowed)
      if (call.body?.revoke === true) state.source.revokedAt = '2026-10-18T01:00:00Z'
      return route.fulfill({ json: { source: state.source } })
    }
    if (path === approvalPath && call.method === 'POST') {
      expect(call.body).toEqual({ expectedLatestVersion: 3, expectedContentHash: hash })
      state.source.current!.approvedAt = '2026-10-18T01:00:00Z'
      return route.fulfill({ json: { source: state.source } })
    }
    return route.fulfill({ status: 503, json: { error: 'SOURCES_UNAVAILABLE' } })
  })
  await page.route(`https://source-deadline.fixture/${lang}`, route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic source recovery</title><style>${readFileSync(css, 'utf8')}</style></head><body>${readFileSync(`${dir}/${lang}-default.html`, 'utf8')}<script>${readFileSync(`${dir}/fixture.js`, 'utf8')}</script></body></html>`,
  }))
  await page.goto(`https://source-deadline.fixture/${lang}`)
  await page.waitForFunction(() => Boolean((window as Window & { c9cFixtureReady?: boolean }).c9cFixtureReady))
  await page.getByLabel(copy.pagination.filter).selectOption('awaiting-approval')
  await expect(page.getByRole('heading', { name: source.label, exact: true })).toBeVisible()
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: source.label, exact: true }) })
  const review = page.getByRole('region', { name: copy.actions.reviewVersion, exact: true })
  const fill = async () => {
    await page.getByLabel(copy.import.label, { exact: true }).fill('Retain draft input')
    await page.getByLabel(copy.import.key, { exact: false }).fill('retained-draft')
    await page.getByLabel(copy.import.question, { exact: true }).fill('Draft question')
    await page.getByLabel(copy.import.answer, { exact: true }).fill('Draft answer')
  }
  const retainedInput = async () => {
    await expect(page.getByLabel(copy.import.label, { exact: true })).toHaveValue('Retain draft input')
    await expect(page.getByLabel(copy.import.question, { exact: true })).toHaveValue('Draft question')
    await expect(page.getByLabel(copy.import.answer, { exact: true })).toHaveValue('Draft answer')
  }
  return { copy, state, card, review, fill, retainedInput }
}

function stalled() {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  return {
    release,
    handle: async (route: Route) => {
      await gate
      try { await route.abort() } catch { /* The browser deadline may already have cancelled the request. */ }
    },
  }
}

async function failureEvidence(page: Page, copy: typeof en.sources, name: string, deadline = true, dependency = false) {
  try {
    await expect(page.getByRole('alert')).toHaveText(dependency ? copy.errors.SOURCES_UNAVAILABLE : copy.actions.failed, { timeout: deadline ? 17_000 : 5000 })
    await expect(page.getByRole('alert')).not.toContainText(
      name.startsWith('en-') ? 'Nothing has been changed.' : '系統未作任何更改。',
    )
    await expect(page.getByRole('alert')).not.toContainText(
      name.startsWith('en-') ? 'Nothing was saved.' : '未有儲存任何內容',
    )
  } catch (error) {
    await page.screenshot({ path: test.info().outputPath(name + '-red.png'), fullPage: true })
    throw error
  }
  await expect(page.locator('[aria-live="polite"]')).toHaveText('')
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath(name + '-failed.png'), fullPage: true })
}

for (const lang of ['en', 'zh-HK']) {
  for (const operation of ['allow', 'revoke'] as const) {
    test(`Sources stalled ${operation} unlocks exact manual retry ${lang}`, async ({ page }) => {
      const f = await fixture(page, lang), { copy, state, card } = f
      await f.fill()
      const pending = stalled()
      state.hook = (route, call) => {
        expect(call).toMatchObject({ method: 'PATCH', path: detailPath,
          body: operation === 'allow' ? { agentUseAllowed: true } : { revoke: true } })
        return pending.handle(route)
      }
      const button = card.getByRole('button', { name: copy.actions[operation], exact: true })
      try {
        await button.dblclick()
        await failureEvidence(page, copy, `${lang}-${operation}`)
        await expect(button).toBeEnabled()
        await f.retainedInput()
        const writes = () => state.calls.filter(call => call.method === 'PATCH')
        expect(writes()).toHaveLength(1)
        expect(state.source.agentUseAllowed).toBe(false)
        expect(state.source.revokedAt).toBeNull()
        state.hook = null
        pending.release()
        await button.click()
        await expect(page.locator('[aria-live="polite"]')).toHaveText(copy.actions[operation === 'allow' ? 'saved' : 'revoked'])
        expect(writes()).toHaveLength(2)
        expect(writes()[1]).toEqual(writes()[0])
        await f.retainedInput()
        expect(state.errors).toEqual([])
      } finally { pending.release() }
    })
  }
  test(`Sources stalled review unlocks without approving any source ${lang}`, async ({ page }) => {
    const f = await fixture(page, lang), { copy, state, card, review } = f
    await f.fill()
    const pending = stalled()
    state.hook = (route, call) => {
      expect(call).toMatchObject({ method: 'GET', path: detailPath })
      return pending.handle(route)
    }
    const button = card.getByRole('button', { name: copy.actions.reviewVersion, exact: true })
    try {
      await button.dblclick()
      await failureEvidence(page, copy, lang + '-review')
      await expect(button).toBeEnabled()
      await expect(review).toHaveCount(0)
      await f.retainedInput()
      expect(state.calls.filter(call => call.path === detailPath)).toHaveLength(1)
      expect(state.calls.filter(call => call.method !== 'GET')).toEqual([])
      state.hook = null
      pending.release()
      await button.click()
      await expect(review).toContainText('synthetic-source-3')
      await expect(review).toContainText('Retained answer version three.')
      expect(state.calls.filter(call => call.path === detailPath)).toHaveLength(2)
      expect(state.calls.filter(call => call.method !== 'GET')).toEqual([])
      expect(state.errors).toEqual([])
    } finally { pending.release() }
  })
  for (const outcome of ['retry', 'conflict', 'committed-timeout', 'committed-network', 'committed-http'] as const) {
    test(`Sources ${outcome} approval preserves reviewed identity and uncertainty ${lang}`, async ({ page }) => {
      const f = await fixture(page, lang), { copy, state, card, review } = f
      await f.fill()
      await card.getByRole('button', { name: copy.actions.reviewVersion, exact: true }).click()
      await expect(review).toContainText('Retained answer version three.')
      const pending = stalled()
      state.hook = async (route, call) => {
        expect(call).toEqual({ method: 'POST', path: approvalPath, body: { expectedLatestVersion: 3, expectedContentHash: hash } })
        if (outcome.startsWith('committed')) state.source.current!.approvedAt = '2026-10-18T01:00:00Z'
        if (outcome === 'committed-network') return route.abort()
        if (outcome === 'committed-http') return route.fulfill({ status: 503, json: { error: 'SOURCES_UNAVAILABLE' } })
        return pending.handle(route)
      }
      const button = review.getByRole('button', { name: copy.actions.approveVersion, exact: true })
      const writes = () => state.calls.filter(call => call.method === 'POST')
      try {
        await button.dblclick()
        await failureEvidence(page, copy, `${lang}-${outcome}`, outcome !== 'committed-network' && outcome !== 'committed-http', outcome === 'committed-http')
        await expect(button).toBeEnabled()
        await expect(review.getByRole('button', { name: copy.actions.cancelReview, exact: true })).toBeEnabled()
        await expect(review).toContainText('Retained answer version three.')
        await f.retainedInput()
        expect(writes()).toHaveLength(1)
        pending.release()
        if (outcome.startsWith('committed')) {
          state.hook = null
          await review.getByRole('button', { name: copy.actions.cancelReview, exact: true }).click()
          await card.getByRole('button', { name: copy.actions.reviewVersion, exact: true }).click()
          await expect(review.getByRole('button', { name: copy.actions.approveVersion, exact: true })).toBeDisabled()
          await expect(review).toContainText('synthetic-source-3')
          await expect(page.getByRole('alert')).toHaveCount(0)
          expect(writes()).toHaveLength(1)
        } else {
          if (outcome === 'conflict') {
            state.source.latestVersion = 4
            state.source.current = { ...state.source.current!, id: '00000000-0000-4000-8000-000000000103',
              versionNumber: 4, contentHash: 'b'.repeat(64),
              entries: [{ question: 'Newer question', answer: 'Unreviewed version four.' }] }
          }
          state.hook = outcome === 'conflict' ? (route, call) => {
            expect(call).toEqual(writes()[0])
            return route.fulfill({ status: 409, json: { error: 'SOURCES_CONFLICT' } })
          } : null
          await button.click()
          if (outcome === 'conflict') {
            await expect(page.getByRole('alert')).toHaveText(copy.errors.SOURCES_CONFLICT)
            await expect(review).toContainText('Retained answer version three.')
            await expect(review).not.toContainText('Unreviewed version four.')
            expect(state.source.current!.approvedAt).toBeNull()
          } else {
            await expect(review).toHaveCount(0)
            await expect(page.locator('[aria-live="polite"]')).toContainText(copy.actions.approved)
          }
          expect(writes()).toHaveLength(2)
          expect(writes()[1]).toEqual(writes()[0])
        }
        expect(state.source.latestVersion).toBe(outcome === 'conflict' ? 4 : 3)
        expect(state.source.agentUseAllowed).toBe(false)
        await f.retainedInput()
        await page.screenshot({ path: test.info().outputPath(`${lang}-${outcome}-recovered.png`), fullPage: true })
        expect(state.errors).toEqual([])
      } finally { pending.release() }
    })
  }
}
