import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { composeSavedReply } from '../../lib/conversation-studio/reply'
import { savedStudioEvidence } from '../../__tests__/helpers/studio-evidence'
import type { StudioThreadRecord, StudioTurnRecord } from '../../lib/conversation-studio/threads-types'
import type { StudioLiveReply } from '../../lib/conversation-studio/live-types'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'

const origin = 'https://studio-chat.fixture'
const clientId = '11111111-1111-4111-8111-111111111111'
const base = `/api/dashboard/clients/${clientId}/studio`
function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
type Stored = { record: StudioThreadRecord; turns: StudioTurnRecord[] }
type AnswerRequest = { prompt: string; platforms: string[]; language: string; threadId: string; position: number }

// These isolated responses model the published HTTP contract. They do not prove
// live model execution or database isolation; backend and release checks do that.
async function fixture(page: Page, lang: string, options: { holdList?: boolean; holdAppend?: boolean; loseAnswer?: boolean; pendingAnswer?: boolean; initialAsk?: string; preclaimError?: boolean; holdDetailRead?: number; failDetailRead?: number; holdAnswerResponse?: boolean; detailSnapshotAtRelease?: boolean; detailTitle?: string; initialTask?: string } = {}) {
  const directory = process.env.STUDIO_HTML_DIR ?? '.next/component-fixtures/STUDIO'
  const js = readFileSync(`${directory}/chat-fixture.js`, 'utf8')
  const css = readFileSync(`${directory}/chat-build.css`, 'utf8')
  const threads = new Map<string, Stored>()
  const requests: { method: string; path: string }[] = []
  const unexpected: string[] = []
  const answers: AnswerRequest[] = []
  const listGate = gate(), appendGate = gate(), appendStarted = gate(), detailGate = gate(), detailStarted = gate(), answerGate = gate(), answerStarted = gate()
  let pending: (() => void) | undefined
  let listHeld = false, appendHeld = false, responseLost = false, preclaimFailed = false, detailReads = 0
  const record = (stored: Stored) => ({ ...stored.record, turnCount: stored.turns.length })
  const responseFor = (input: AnswerRequest): StudioLiveReply => ({
    quota: { cap: 10, remaining: Math.max(0, 10 - answers.length), scope: 'brand' },
    answers: [{ platform: 'gemini-flash', answer: `MODEL REPLY ${input.position + 1}: ${input.prompt}`, coverage: 'present', model: 'offline-model', startedAt: '2026-11-15T02:00:00Z', durationMs: 1, finishReason: 'stop', grounding: 'none', searchEvidence: { requested: 'none', execution: 'unknown', basis: 'request-only' }, citations: [], error: null }],
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method()
    if (url.origin === origin && request.isNavigationRequest() && url.pathname === `/${lang}/dashboard/${clientId}/studio`) {
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Studio continuous conversation fixture</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>` })
    }
    if (url.origin !== origin) { unexpected.push(`${method} ${url.origin}${url.pathname}`); return route.abort() }
    if (url.pathname === '/favicon.ico' && method === 'GET') return route.fulfill({ status: 204 })
    requests.push({ method, path: url.pathname })
    if (url.pathname === `${base}/threads` && method === 'GET') {
      const snapshot = [...threads.values()].map(record)
      if (options.holdList && !listHeld) { listHeld = true; await listGate.promise }
      return route.fulfill({ json: { threads: snapshot, truncated: false } })
    }
    if (url.pathname === `${base}/threads` && method === 'POST') {
      const input = request.postDataJSON()
      const id = crypto.randomUUID(), now = '2026-11-15T02:00:00Z'
      const stored: Stored = { record: { id, title: input.title, goal: input.goal, week: input.week ?? null, kind: input.kind, sourceTitle: null, createdAt: now, updatedAt: now, turnCount: 0, skill: input.skill ?? null, visibility: 'private', pinned: false, archived: false, mine: true, branchOf: null }, turns: [] }
      threads.set(id, stored)
      return route.fulfill({ status: 201, json: { thread: record(stored) } })
    }
    const detail = url.pathname.match(new RegExp(`^${base}/threads/([a-f0-9-]+)(/turns)?$`))
    if (detail) {
      const stored = threads.get(detail[1])
      if (!stored) return route.fulfill({ status: 404, json: { error: 'NOT_FOUND' } })
      if (!detail[2] && method === 'GET') {
        let snapshot = structuredClone({ thread: record(stored), turns: stored.turns })
        detailReads += 1
        if (options.failDetailRead === detailReads) return route.fulfill({ status: 503, json: { error: 'STUDIO_THREADS_UNAVAILABLE' } })
        if (options.holdDetailRead === detailReads) {
          detailStarted.release(); await detailGate.promise
          if (options.detailSnapshotAtRelease) snapshot = structuredClone({ thread: record(stored), turns: stored.turns })
          if (options.detailTitle) snapshot.thread.title = options.detailTitle
        }
        return route.fulfill({ json: snapshot })
      }
      if (detail[2] && method === 'POST') {
        appendStarted.release()
        if (options.holdAppend && !appendHeld) { appendHeld = true; await appendGate.promise }
        const input = request.postDataJSON()
        const existing = stored.turns.find(turn => turn.requestId === input.requestId)
        if (existing) return route.fulfill({ status: 201, json: { turn: existing } })
        const turn: StudioTurnRecord = { id: crypto.randomUUID(), position: stored.turns.length, prompt: input.prompt, task: input.task ?? null, reply: composeSavedReply(input.prompt, null, savedStudioEvidence), attached: null, live: null, receipts: null, requestId: input.requestId, createdAt: '2026-11-15T02:00:00Z' }
        stored.turns.push(turn)
        return route.fulfill({ status: 201, json: { turn } })
      }
    }
    if (url.pathname === `${base}/answer` && method === 'POST') {
      const input = request.postDataJSON() as AnswerRequest
      const stored = threads.get(input.threadId), turn = stored?.turns.find(item => item.position === input.position)
      if (!turn || turn.prompt !== input.prompt) return route.fulfill({ status: 404, json: { error: 'NOT_FOUND' } })
      if (options.preclaimError && !preclaimFailed) { preclaimFailed = true; return route.fulfill({ status: 503, json: { error: 'STUDIO_UNAVAILABLE' } }) }
      answers.push(input)
      const reply = responseFor(input)
      const complete = () => { turn.live = { reply }; turn.answerState = 'complete' }
      if (options.pendingAnswer && !pending) {
        turn.live = { error: 'STUDIO_ANSWER_PENDING' }; turn.answerState = 'pending'; pending = complete
        return route.fulfill({ status: 409, json: { error: 'STUDIO_ANSWER_PENDING' } })
      }
      if (options.holdAnswerResponse) {
        turn.live = { error: 'STUDIO_ANSWER_PENDING' }; turn.answerState = 'pending'
        answerStarted.release(); await answerGate.promise
      }
      complete()
      if (options.loseAnswer && !responseLost) { responseLost = true; return route.abort() }
      return route.fulfill({ json: reply })
    }
    unexpected.push(`${method} ${url.pathname}`)
    return route.abort()
  })
  const params = new URLSearchParams()
  if (options.initialAsk) params.set('ask', options.initialAsk)
  if (options.initialTask) params.set('task', options.initialTask)
  await page.goto(`${origin}/${lang}/dashboard/${clientId}/studio${params.size ? `?${params}` : ''}`)
  await expect(page.locator('#studio-composer')).toBeVisible()
  return { copy: (lang === 'en' ? en : zh).conversationStudio, threads, requests, answers, unexpected, releaseList: listGate.release, releaseAppend: appendGate.release, appendStarted: appendStarted.promise, releaseDetail: detailGate.release, detailStarted: detailStarted.promise, releaseAnswer: answerGate.release, answerStarted: answerStarted.promise, completePending: () => pending?.() }
}

for (const lang of ['en', 'zh-HK']) {
  test(`real chat components keep one saved discussion through follow-ups and a hard reload in ${lang}`, async ({ page }) => {
    const state = await fixture(page, lang)
    const composer = page.locator('#studio-composer')
    await composer.fill('Remember the working name RIVER-47.')
    await composer.press('Enter')
    await expect(page.getByText('MODEL REPLY 1: Remember the working name RIVER-47.', { exact: true })).toBeVisible()
    const id = [...state.threads.keys()][0]
    await expect(page).toHaveURL(new RegExp(`\\?thread=${id}$`))
    await composer.fill('What is the working name?')
    await composer.press('Enter')
    await expect(page.getByText('MODEL REPLY 2: What is the working name?', { exact: true })).toBeVisible()
    expect(state.answers.map(answer => [answer.threadId, answer.position])).toEqual([[id, 0], [id, 1]])
    expect(state.threads.size).toBe(1)
    await page.reload()
    await expect(page.getByRole('log')).toBeVisible()
    await expect(page.getByText('MODEL REPLY 1: Remember the working name RIVER-47.', { exact: true })).toBeVisible()
    await expect(page.getByText('MODEL REPLY 2: What is the working name?', { exact: true })).toBeVisible()
    await composer.fill('Continue in this same discussion.')
    await composer.press('Enter')
    await expect(page.getByText('MODEL REPLY 3: Continue in this same discussion.', { exact: true })).toBeVisible()
    expect(state.answers.at(-1)?.threadId).toBe(id)
    expect(state.answers.at(-1)?.position).toBe(2)
    expect(state.requests.some(request => request.method === 'PATCH')).toBe(false)
    await expect(page.locator('.as-saved-context[open]')).toHaveCount(0)
    expect(state.unexpected).toEqual([])
  })

  test(`a late initial thread list cannot erase a newly persisted conversation in ${lang}`, async ({ page }) => {
    const state = await fixture(page, lang, { holdList: true })
    await page.locator('#studio-composer').fill('Keep this new discussion when the old list arrives.')
    await page.locator('button[type=submit]').click()
    await expect(page.getByText('MODEL REPLY 1: Keep this new discussion when the old list arrives.', { exact: true })).toBeVisible()
    const finished = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === `${base}/threads`)
    state.releaseList()
    await finished
    await expect(page.getByRole('log')).toBeVisible()
    await expect(page.getByText('MODEL REPLY 1: Keep this new discussion when the old list arrives.', { exact: true })).toBeVisible()
    expect(state.threads.size).toBe(1)
    expect(state.answers).toHaveLength(1)
    expect(state.unexpected).toEqual([])
  })

  test(`the entire append and model request is serialized and preserves a draft typed while waiting in ${lang}`, async ({ page }) => {
    const state = await fixture(page, lang, { holdAppend: true })
    const composer = page.locator('#studio-composer')
    await composer.fill('The first submitted message.')
    await page.locator('button[type=submit]').click()
    await state.appendStarted
    await composer.fill('The next draft stays here.')
    await page.locator('form').evaluate(form => { (form as HTMLFormElement).requestSubmit(); (form as HTMLFormElement).requestSubmit() })
    await expect(page.locator('button[type=submit]')).toBeDisabled()
    expect(state.requests.filter(request => request.method === 'POST' && request.path.endsWith('/turns'))).toHaveLength(1)
    expect(state.answers).toHaveLength(0)
    state.releaseAppend()
    await expect(page.getByText('MODEL REPLY 1: The first submitted message.', { exact: true })).toBeVisible()
    await expect(composer).toHaveValue('The next draft stays here.')
    expect(state.answers).toHaveLength(1)
    expect(state.unexpected).toEqual([])
  })

  test(`a lost answer response is reconciled with a read and survives reload without another model dispatch in ${lang}`, async ({ page }) => {
    const state = await fixture(page, lang, { loseAnswer: true })
    await page.locator('#studio-composer').fill('Keep the assistant answer when its response is lost.')
    await page.locator('button[type=submit]').click()
    await expect(page.getByText('MODEL REPLY 1: Keep the assistant answer when its response is lost.', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByText('MODEL REPLY 1: Keep the assistant answer when its response is lost.', { exact: true })).toBeVisible()
    expect(state.answers).toHaveLength(1)
    expect(state.requests.filter(request => request.method === 'GET' && request.path.startsWith(`${base}/threads/`)).length).toBeGreaterThanOrEqual(2)
    expect(state.requests.some(request => request.method === 'PATCH')).toBe(false)
    expect(state.unexpected).toEqual([])
  })

  test(`pending answers only refresh saved state and preserve the next draft in ${lang}`, async ({ page }) => {
    const state = await fixture(page, lang, { pendingAnswer: true })
    const composer = page.locator('#studio-composer')
    await composer.fill('Wait for this one answer.')
    await page.locator('button[type=submit]').click()
    const refresh = page.getByRole('button', { name: state.copy.live.refreshReply, exact: true })
    await expect(refresh).toBeEnabled()
    await composer.fill('A draft for the next turn.')
    await expect(page.locator('button[type=submit]')).toBeDisabled()
    await page.reload()
    await expect(refresh).toBeEnabled()
    await composer.fill('A draft after reload.')
    state.completePending()
    await refresh.click()
    await expect(page.getByText('MODEL REPLY 1: Wait for this one answer.', { exact: true })).toBeVisible()
    await expect(composer).toHaveValue('A draft after reload.')
    await expect(page.locator('button[type=submit]')).toBeEnabled()
    expect(state.answers).toHaveLength(1)
    expect(state.unexpected).toEqual([])
  })

  test(`a preclaim error stays visible when readback has no stored model result in ${lang}`, async ({ page }) => {
    const state = await fixture(page, lang, { preclaimError: true })
    const readback = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname.startsWith(`${base}/threads/`))
    await page.locator('#studio-composer').fill('A message whose model request never started.')
    await page.locator('button[type=submit]').click()
    await readback
    await expect(page.getByRole('alert').filter({ hasText: state.copy.live.unavailable })).toBeVisible()
    await expect(page.getByRole('button', { name: state.copy.live.refreshReply, exact: true })).toBeEnabled()
    expect(state.answers).toHaveLength(0)
    expect([...state.threads.values()][0].turns[0].live).toBeNull()
    expect(state.requests.filter(request => request.method === 'POST' && request.path.endsWith('/answer'))).toHaveLength(1)
    expect(state.unexpected).toEqual([])
  })

  test(`an older forced read cannot erase a newly acknowledged user turn or assistant reply in ${lang}`, async ({ page }) => {
    const state = await fixture(page, lang, { preclaimError: true, holdDetailRead: 2, detailTitle: 'Older snapshot applied' })
    const composer = page.locator('#studio-composer')
    await composer.fill('The earlier message has a visible model error.')
    await page.locator('button[type=submit]').click()
    const refresh = page.getByRole('button', { name: state.copy.live.refreshReply, exact: true })
    await expect(refresh).toBeEnabled()
    await refresh.click()
    await state.detailStarted
    await composer.fill('Keep this new acknowledged turn and answer.')
    await page.locator('button[type=submit]').click()
    await expect(page.getByText('MODEL REPLY 2: Keep this new acknowledged turn and answer.', { exact: true })).toBeVisible()
    const oldRead = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname.startsWith(`${base}/threads/`))
    state.releaseDetail()
    await oldRead
    await expect(page.getByRole('heading', { name: 'Older snapshot applied', exact: true })).toBeVisible()
    await expect(page.getByText('MODEL REPLY 2: Keep this new acknowledged turn and answer.', { exact: true })).toBeVisible()
    await expect(page.getByRole('log').getByText('Keep this new acknowledged turn and answer.', { exact: true })).toBeVisible()
    expect([...state.threads.values()][0].turns).toHaveLength(2)
    expect(state.answers).toHaveLength(1)
    expect(state.unexpected).toEqual([])
  })

  test(`a completed answer clears managed pending installed by an earlier refresh in ${lang}`, async ({ page }) => {
    const state = await fixture(page, lang, { preclaimError: true, holdDetailRead: 2, holdAnswerResponse: true, detailSnapshotAtRelease: true, detailTitle: 'Server snapshot applied' })
    const composer = page.locator('#studio-composer')
    await composer.fill('Create a readable earlier error.')
    await page.locator('button[type=submit]').click()
    const refresh = page.getByRole('button', { name: state.copy.live.refreshReply, exact: true })
    await expect(refresh).toBeEnabled()
    await refresh.click()
    await state.detailStarted
    await composer.fill('Finish this answer after the managed pending read.')
    await page.locator('button[type=submit]').click()
    await state.answerStarted
    state.releaseDetail()
    // The renamed heading proves the held GET has actually updated React before
    // the POST completes; a response event alone would not establish that order.
    await expect(page.getByRole('heading', { name: 'Server snapshot applied', exact: true })).toBeVisible()
    await composer.fill('The next question should be sendable.')
    state.releaseAnswer()
    await expect(page.getByText('MODEL REPLY 2: Finish this answer after the managed pending read.', { exact: true })).toBeVisible()
    await expect(composer).toHaveValue('The next question should be sendable.')
    await expect(page.locator('button[type=submit]')).toBeEnabled()
    expect(state.answers).toHaveLength(1)
    expect(state.unexpected).toEqual([])
  })

  test(`Enter obeys the same failed-history guard as the disabled Send button in ${lang}`, async ({ page }) => {
    const state = await fixture(page, lang, { preclaimError: true, failDetailRead: 1 })
    const composer = page.locator('#studio-composer')
    await composer.fill('Trigger a failed readback without a model result.')
    await page.locator('button[type=submit]').click()
    await expect(page.getByRole('alert').filter({ hasText: state.copy.readUnavailable })).toBeVisible()
    await composer.fill('Keep this unsent question while history is unavailable.')
    await expect(page.locator('button[type=submit]')).toBeDisabled()
    await composer.press('Enter')
    await expect(composer).toHaveValue('Keep this unsent question while history is unavailable.')
    expect(state.requests.filter(request => request.method === 'POST' && request.path.endsWith('/turns'))).toHaveLength(1)
    expect(state.answers).toHaveLength(0)
    expect(state.unexpected).toEqual([])
  })

  test(`task selection edits the question before explicit Send and Today prefills the embedded provider in ${lang}`, async ({ page }) => {
    const state = await fixture(page, lang, { initialAsk: 'A question carried from Today.' })
    const composer = page.locator('#studio-composer')
    await expect(composer).toHaveValue('A question carried from Today.')
    await page.getByRole('button', { name: state.copy.templates.improve.label, exact: true }).click()
    await expect(composer).toHaveValue(state.copy.templates.improve.prompt)
    await expect(composer).toBeFocused()
    expect(state.requests.filter(request => request.method !== 'GET')).toEqual([])
    await composer.fill('An edited question without a public URL.')
    await page.locator('button[type=submit]').click()
    await expect(page.getByText('MODEL REPLY 1: An edited question without a public URL.', { exact: true })).toBeVisible()
    expect(state.answers).toHaveLength(1)
    expect(state.answers[0].prompt).toBe('An edited question without a public URL.')
    expect(state.unexpected).toEqual([])
  })

  test(`action-card handoff opens the same task and still waits for explicit Send in ${lang}`, async ({ page }) => {
    const state = await fixture(page, lang, { initialAsk: 'Why was my brand missed this week?', initialTask: 'pulse' })
    const composer = page.locator('#studio-composer')
    const chip = state.copy.skillChip.label.replace('{skill}', state.copy.templates.pulse.label)
    await expect(composer).toHaveValue('Why was my brand missed this week?')
    await expect(page.getByText(chip, { exact: true })).toBeVisible()
    await expect(page.locator('button[type=submit]')).toBeEnabled()
    expect(state.requests.filter(request => request.method !== 'GET')).toEqual([])
  })

  test(`Shift+Enter and composition keep text local; an ordinary URL question starts no research providers in ${lang}`, async ({ page }) => {
    const state = await fixture(page, lang)
    const composer = page.locator('#studio-composer')
    await composer.fill('Line one')
    await composer.press('Shift+Enter')
    await composer.type('Line two')
    await expect(composer).toHaveValue('Line one\nLine two')
    await composer.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 })
    expect(state.answers).toHaveLength(0)
    await composer.fill('Discuss the wording of https://example.invalid/draft without fetching it.')
    await composer.press('Enter')
    await expect(page.getByText('MODEL REPLY 1: Discuss the wording of https://example.invalid/draft without fetching it.', { exact: true })).toBeVisible()
    expect(state.unexpected).toEqual([])
    const violations = (await new AxeBuilder({ page }).analyze()).violations
    expect(violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}
