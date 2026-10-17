import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { WorkItem } from '../../lib/work-items/schema'
import type { VersionDetail } from '../../lib/change-sets/types'
import { fingerprintEvidence } from '../../lib/opportunities/fingerprint'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'
import { version as reviewFixture } from '../../__tests__/components/c9d-fixtures'
import AxeBuilder from '@axe-core/playwright'

const dir = resolve('artifacts/result-to-draft-20261017/browser')
const data = () => JSON.parse(readFileSync(resolve(dir, 'data.json'), 'utf8'))
async function fixture(page: Page, lang: string, mode = '', scenario = '') {
  const d = data(), copy = lang === 'en' ? en : zh
  const state = { item: null as WorkItem | null, version: null as VersionDetail | null, creates: 0, edits: 0, submissions: 0, decisions: 0,
    authenticated: true, failCreate: false, loseCreateReply: false, failEdit: false, timeoutCreate: false, scanRequests: [] as string[] }
  if(scenario==='attached') {
    state.item=structuredClone(d.drafts[lang]) as WorkItem
    state.item.sourceScanIds=[d.scanId]
    state.item.evidenceSnapshot.source.id='99999999-9999-4999-8999-999999999999'
    if(state.item.evidenceSnapshot.evidence.kind==='scan-check')state.item.evidenceSnapshot.evidence.scanId=state.item.evidenceSnapshot.source.id
  }
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => route.abort())
  const js = readFileSync(resolve(dir, 'fixture.js'), 'utf8'), css = readFileSync(resolve(dir, 'build.css'), 'utf8')
  await page.route('https://journey.fixture/**', route => route.request().resourceType() === 'document'
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic result to draft</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>` })
    : route.abort())
  await page.route('**/api/clients/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    if (!state.authenticated) return route.fulfill({ status: 401, json: { error: 'UNAUTHENTICATED' } })
    if (!path.startsWith(`/api/clients/${d.clientId}/`)) return route.fulfill({ status: 404, json: {} })
    if (path.endsWith('/opportunities')) {
      expect(new URL(request.url()).searchParams.get('scanId')).toBe(d.scanId)
      return route.fulfill({ json: d.opportunities })
    }
    if (path.endsWith('/work-items')) {
      if (method === 'GET') return route.fulfill({ json: { items: state.item ? [state.item] : [], nextCursor: null } })
      state.creates++
      if (state.timeoutCreate) return
      if (state.failCreate) return route.fulfill({ status: 503, json: {} })
      const input = request.postDataJSON()
      expect(input.source).toEqual(d.opportunities.suggestions[0].source)
      expect(input.fingerprint).toBe(d.opportunities.suggestions[0].fingerprint)
      state.item ??= structuredClone(d.drafts[lang])
      if (state.loseCreateReply) return route.abort()
      return route.fulfill({ status: 201, json: { item: state.item } })
    }
    if (path.endsWith('/versions')) {
      if (method === 'GET') return route.fulfill({ json: { versions: state.version ? [state.version] : [], nextCursor: null, latestVersionId: state.version?.id ?? null } })
      state.submissions++
      expect(request.postDataJSON()).toEqual({ expectedRevision: state.item!.revision })
      const content = { schemaVersion: 1 as const, workItemId: state.item!.id, draftRevision: state.item!.revision,
        title: state.item!.title, action: state.item!.action, notes: state.item!.notes, locale: state.item!.locale,
        evidenceSnapshot: state.item!.evidenceSnapshot }
      state.version ??= { ...reviewFixture, ...content, contentHash: fingerprintEvidence(content), submittedAt: '2026-10-17T00:30:00Z' }
      return route.fulfill({ status: 201, json: { version: state.version } })
    }
    if (path.endsWith('/decision')) {
      state.decisions++
      const input = request.postDataJSON()
      state.version = { ...state.version!, decision: { decision: input.decision, reason: input.reason,
        decidedBy: { profileId: '99999999-9999-4999-8999-999999999999', displayName: 'Synthetic independent reviewer', role: 'account_approver' },
        decidedAt: '2026-10-17T01:00:00Z' }, capabilities: { canDecide: false } }
      return route.fulfill({ json: { version: state.version } })
    }
    if (path.endsWith(`/versions/${reviewFixture.id}`)) return route.fulfill({ json: { version: state.version } })
    if (path.endsWith('/delivery')) {
      expect(method).toBe('GET')
      const approved=state.version?.decision?.decision==='approved'
      return route.fulfill({ json: { events: [], activeAttestationId: null, nextCursor: null,
        capabilities: { canExport: approved, canAttest: approved, canWithdraw: false, attestReason: approved?null:'not_approved', withdrawReason: 'no_active_attestation' } } })
    }
    if (path.endsWith(`/work-items/${d.drafts.en.id}`)) {
      if (method === 'PATCH') {
        state.edits++
        if (state.failEdit) return route.fulfill({ status: 503, json: {} })
        const input = request.postDataJSON()
        if (input.expectedRevision !== state.item!.revision) return route.fulfill({ status: 409, json: { error: 'WORK_ITEM_CONFLICT' } })
        const { expectedRevision, ...text } = input
        state.item = { ...state.item!, ...text, revision: expectedRevision + 1 }
      }
      return route.fulfill({ json: { item: state.item } })
    }
    return route.fulfill({ status: 503, json: {} })
  })
  await page.route('**/api/scan', route => {
    state.scanRequests.push(route.request().postDataJSON().requestKey)
    return route.fulfill({ status: 409, json: { error: 'SCAN_OUTCOME_UNKNOWN', state: 'failed', scanId: d.scanId } })
  })
  const url = `https://journey.fixture/${lang}/dashboard/${d.clientId}?step=${mode || 'results'}&scanId=${d.scanId}${scenario ? `&case=${scenario}` : ''}${mode === 'scan' ? '&url=https%3A%2F%2Fexample.test' : ''}`
  await page.goto(url)
  await page.waitForFunction(() => Boolean((window as Window & { aisoDraftFixtureReady?: boolean }).aisoDraftFixtureReady))
  return { state, copy, d, errors, url }
}

for (const lang of ['en', 'zh-HK']) {
  test(`selected scan attached to an existing draft opens it without creating another ${lang}`, async ({page})=>{
    const {state,copy:c}=await fixture(page,lang,'improve','attached')
    await page.getByRole('button',{name:c.opportunities.openDraft,exact:true}).click()
    await expect(page.getByLabel(c.opportunities.titleField,{exact:true})).toHaveValue(state.item!.title)
    expect(state.creates).toBe(0)
    await page.reload()
    await expect(page.getByLabel(c.opportunities.titleField,{exact:true})).toHaveValue(state.item!.title)
    await page.getByRole('link',{name:c.opportunities.versionHistory,exact:true}).click()
    await page.getByRole('link',{name:c.changeSets.backToDrafts,exact:true}).click()
    await expect(page.getByLabel(c.opportunities.titleField,{exact:true})).toHaveValue(state.item!.title)
    expect(state.creates).toBe(0)
  })
  test(`expired scan identity survives automatic reload without a new potentially charged intent ${lang}`, async ({ page }) => {
    const {state}=await fixture(page,lang,'scan')
    await expect(page.getByRole('button',{name:lang==='en'?'Run Scan':'執行掃描',exact:true})).toBeEnabled()
    expect(state.scanRequests).toHaveLength(1)
    await page.reload()
    await expect(page.getByRole('button',{name:lang==='en'?'Run Scan':'執行掃描',exact:true})).toBeEnabled()
    expect(state.scanRequests).toHaveLength(2)
    expect(state.scanRequests[1]).toBe(state.scanRequests[0])
  })
  test(`empty evidence offers no draft and provider failure leaves genuine scan findings visible ${lang}`, async ({ page }) => {
    const { copy: c, state, url } = await fixture(page, lang, 'improve', 'empty')
    await expect(page.getByRole('button', { name: c.opportunities.saveDraft, exact: true })).toHaveCount(0)
    await expect(page.getByText(c.opportunities.empty, { exact: true })).toBeVisible()
    expect(state.creates).toBe(0)
    await page.goto(url.replace('step=improve', 'step=results').replace('case=empty', 'case=provider-failed'))
    await expect(page.getByTestId('saved-scan-summary')).toContainText(c.savedScanSummary.failed)
    await expect(page.getByRole('link', { name: c.dashboard.next_improve, exact: true })).toBeVisible()
    await page.getByRole('link', { name: c.dashboard.next_improve, exact: true }).click()
    await expect(page.getByRole('button', { name: c.opportunities.saveDraft, exact: true })).toHaveCount(2)
    expect(state.creates).toBe(0)
  })
  test(`source result → metadata draft → edit/save → review → return/reload ${lang}`, async ({ page }) => {
    const { state, copy: c, d, errors } = await fixture(page, lang)
    await page.getByRole('link', { name: c.dashboard.next_improve, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`scanId=${d.scanId}`))
    await expect(page.getByText(c.opportunities.scanPriorityReason)).toBeVisible()
    await expect(page.getByText('https://example.test', { exact: false }).first()).toBeVisible()
    await page.getByRole('button', { name: c.opportunities.saveDraft, exact: true }).first().dblclick()
    await expect(page.getByLabel(c.opportunities.action, { exact: true })).toHaveValue(/<meta name="description"/)
    expect(state.creates).toBe(1)
    expect(state.item!.evidenceSnapshot.source).toEqual({ kind: 'scan-check', id: d.scanId, checkKey: 'c9_meta_desc' })
    await page.getByLabel(c.opportunities.action, { exact: true }).fill('Synthetic editing example (not applied): <meta name="description" content="Synthetic fixture page for metadata review.">')
    await page.getByLabel(c.opportunities.notes, { exact: true }).fill('Synthetic manual source check: https://example.test — page owner to verify before applying.')
    await expect(page.getByText(c.opportunities.unsavedChanges, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: c.opportunities.saveChanges, exact: true }).click()
    await expect(page.getByText(c.opportunities.savedRevision.replace('{revision}', '2'), { exact: true })).toBeVisible()
    const saved = structuredClone(state.item)
    await page.reload()
    await expect(page.getByLabel(c.opportunities.notes, { exact: true })).toHaveValue(saved!.notes)
    // Synthetic session boundary: the draft is fetched afresh; this is not live Auth acceptance.
    state.authenticated = false
    await page.reload()
    await expect(page.getByRole('alert')).toContainText(c.opportunities.openError)
    state.authenticated = true
    await page.reload()
    await expect(page.getByLabel(c.opportunities.notes, { exact: true })).toHaveValue(saved!.notes)
    await page.screenshot({ path: test.info().outputPath(`${lang}-saved-draft.png`), fullPage: true })
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    await page.getByRole('link', { name: c.opportunities.versionHistory, exact: true }).click()
    await page.getByRole('button', { name: c.changeSets.submitVersion, exact: true }).click()
    await expect(page.getByRole('region', { name: c.changeSets.versionDetails })).toContainText(saved!.notes)
    expect(state.version!.draftRevision).toBe(2)
    expect(state.version).toMatchObject({ schemaVersion: 1, evidenceSnapshot: saved!.evidenceSnapshot })
    await page.getByLabel(c.changeSets.reason, { exact: true }).fill('Synthetic independent reviewer checked the source. Manual application is still required.')
    await page.getByRole('button', { name: c.changeSets.recordDecision, exact: true }).click()
    await expect(page.getByRole('region', { name: c.changeSets.versionDetails })).toContainText(c.changeSets.approved)
    await expect(page.getByText(c.changeSets.notDelivery, { exact: true })).toBeVisible()
    await page.reload()
    await page.getByRole('button', { name: new RegExp(`^${c.changeSets.versionNumber.replace('{number}', '1')}`) }).click()
    await expect(page.getByRole('region', { name: c.changeSets.versionDetails })).toContainText(saved!.notes)
    await expect(page.getByRole('region', { name: c.changeSets.versionDetails })).toContainText(c.changeSets.approved)
    await page.screenshot({ path: test.info().outputPath(`${lang}-confirmed-private-version.png`), fullPage: true })
    await page.getByRole('region', { name: c.changeSets.versionDetails }).screenshot({ path: test.info().outputPath(`${lang}-reviewed-version-detail.png`) })
    await page.getByRole('link', { name: c.changeSets.backToDrafts, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`step=improve&scanId=${d.scanId}&draft=${saved!.id}`))
    await expect(page.getByLabel(c.opportunities.notes, { exact: true })).toHaveValue(saved!.notes)
    expect(state.edits).toBe(1)
    expect(state.submissions).toBe(1)
    expect(state.decisions).toBe(1)
    expect(errors).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
  test(`lost create reply retries the same source; failed edit and stale tab retain input ${lang}`, async ({ page }) => {
    const { state, copy: c, errors } = await fixture(page, lang, 'improve')
    state.loseCreateReply = true
    await page.getByRole('button', { name: c.opportunities.saveDraft, exact: true }).first().click()
    await expect(page.getByRole('alert')).toContainText(c.opportunities.saveError)
    const original = state.item!.id
    state.loseCreateReply = false
    await page.getByRole('button', { name: c.opportunities.saveDraft, exact: true }).first().click()
    await expect(page.getByLabel(c.opportunities.titleField, { exact: true })).toBeVisible()
    expect(state.item!.id).toBe(original)
    await page.getByLabel(c.opportunities.notes, { exact: true }).fill('Unsaved local edit')
    state.failEdit = true
    await page.getByRole('button', { name: c.opportunities.saveChanges, exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(c.opportunities.editError)
    await expect(page.getByLabel(c.opportunities.notes, { exact: true })).toHaveValue('Unsaved local edit')
    state.failEdit = false
    state.item = { ...state.item!, notes: 'Newer saved content from another tab', revision: 2 }
    await page.getByRole('button', { name: c.opportunities.saveChanges, exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(c.opportunities.editConflict)
    await expect(page.getByLabel(c.opportunities.notes, { exact: true })).toHaveValue('Unsaved local edit')
    expect(state.item.notes).toBe('Newer saved content from another tab')
    await page.getByRole('button', { name: c.opportunities.suggestions, exact: true }).click()
    await page.getByRole('button', { name: c.opportunities.savedDrafts, exact: true }).click()
    await expect(page.getByLabel(c.opportunities.notes, { exact: true })).toHaveValue('Unsaved local edit')
    await page.getByRole('button', { name: c.opportunities.reloadDraft, exact: true }).click()
    await expect(page.getByLabel(c.opportunities.notes, { exact: true })).toHaveValue(state.item.notes)
    expect(errors).toEqual([])
  })
  test(`timeout unlocks one explicit retry without rescanning or calling a provider ${lang}`, async ({ page }) => {
    const { state, copy: c } = await fixture(page, lang, 'improve')
    state.timeoutCreate = true
    await page.getByRole('button', { name: c.opportunities.saveDraft, exact: true }).first().click()
    await expect(page.getByRole('alert')).toContainText(c.opportunities.saveError, { timeout: 20_000 })
    expect(state.creates).toBe(1)
    state.timeoutCreate = false
    await page.getByRole('button', { name: c.opportunities.saveDraft, exact: true }).first().click()
    await expect(page.getByLabel(c.opportunities.titleField, { exact: true })).toBeVisible()
    expect(state.creates).toBe(2)
  })
}
