import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { composeSavedReply } from '../../lib/conversation-studio/reply'
import { savedStudioEvidence } from '../../__tests__/helpers/studio-evidence'
import type { StudioLiveReply } from '../../lib/conversation-studio/live-types'

const origin = 'https://studio.fixture'
const clientId = '11111111-1111-4111-8111-111111111111'
const threadId = '99999999-9999-4999-8999-999999999999'
const savedAnswer = 'The latest saved model reply.'
const completedAnswer = 'The newly completed model reply.'
const reply = (answer: string): StudioLiveReply => ({
  quota: { cap: 10, remaining: 6, scope: 'brand' },
  answers: [{ platform: 'gemini-flash', answer, coverage: 'present', model: 'offline-layout-fixture', startedAt: '2026-11-15T02:00:00Z', durationMs: 1, finishReason: 'stop', grounding: 'none', searchEvidence: { requested: 'none', execution: 'unknown', basis: 'request-only' }, citations: [], error: null }],
})

// A short answer must fit above the sibling sticky composer and receive pointer
// hits. Visibility alone also passes when the composer covers the entire answer.
async function expectReadable(page: Page, answer: Locator) {
  await expect(answer).toBeVisible()
  await expect.poll(() => answer.evaluate(node => {
    const box = node.getBoundingClientRect(), composer = document.querySelector('#studio-composer')?.closest('form')?.getBoundingClientRect()
    let top = 0, bottom = innerHeight
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (!/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) continue
      const rect = parent.getBoundingClientRect()
      top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom)
    }
    if (composer) bottom = Math.min(bottom, composer.top)
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return box.top >= top - 1 && box.bottom <= bottom + 1 && Boolean(hit && (hit === node || node.contains(hit)))
  }), { message: 'Latest model text must be unobscured above the composer without test scrolling', timeout: 5000 }).toBe(true)
  expect(await page.locator('#studio-composer').count()).toBe(1)
}

for (const lang of ['en', 'zh-HK']) {
  test(`latest reply stays clear of the composer after reload and model completion in ${lang}`, async ({ page, isMobile }) => {
    await page.setViewportSize({ width: isMobile ? 390 : 1440, height: isMobile ? 844 : 1000 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    const directory = process.env.STUDIO_HTML_DIR ?? '.next/component-fixtures/STUDIO'
    const js = readFileSync(`${directory}/shell-fixture.js`, 'utf8'), css = readFileSync(`${directory}/build.css`, 'utf8')
    const turns = Array.from({ length: 3 }, (_, position) => {
      const prompt = `Earlier saved question ${position + 1}. ${'Keep this earlier discussion context available. '.repeat(10)}`
      return { id: `80000000-0000-4000-8000-00000000000${position}`, position, prompt, task: null, reply: composeSavedReply(prompt, null, savedStudioEvidence), attached: null, live: { reply: reply(position === 2 ? savedAnswer : `Earlier model reply ${position + 1}.`) }, answerState: 'complete', receipts: null, requestId: null, createdAt: '2026-11-15T02:00:00Z' }
    })
    const thread = { id: threadId, title: 'A long saved conversation', goal: turns[0].prompt, week: null, kind: 'research', sourceTitle: null, createdAt: '2026-11-15T02:00:00Z', updatedAt: '2026-11-15T02:00:00Z', turns }
    await page.addInitScript(({ key, thread }) => {
      if (!sessionStorage.getItem('scroll-fixture-seeded')) {
        localStorage.setItem(key, JSON.stringify([thread]))
        sessionStorage.setItem('scroll-fixture-seeded', 'true')
      }
    }, { key: `studio-threads:account-a:${clientId}`, thread })
    const unexpected: string[] = []
    let release!: () => void, started!: () => void, answerRequests = 0
    const answerGate = new Promise<void>(resolve => { release = resolve }), answerStarted = new Promise<void>(resolve => { started = resolve })
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin === origin && request.method() === 'GET' && request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Studio reply scrolling fixture</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>` })
      if (url.origin === origin && url.pathname === `/api/dashboard/clients/${clientId}/studio/answer` && request.method() === 'POST') {
        answerRequests += 1
        const input = request.postDataJSON()
        expect(input.threadId).toBe(threadId); expect(input.position).toBe(3)
        started(); await answerGate
        const completed = reply(completedAnswer)
        await page.evaluate(({ key, threadId, completed }) => {
          const stored = JSON.parse(localStorage.getItem(key) ?? '[]')
          const turn = stored.find((item: { id: string }) => item.id === threadId).turns[3]
          turn.live = { reply: completed }; turn.answerState = 'complete'
          localStorage.setItem(key, JSON.stringify(stored))
        }, { key: `studio-threads:account-a:${clientId}`, threadId, completed })
        return route.fulfill({ json: completed })
      }
      if (url.origin === origin && url.pathname === '/favicon.ico') return route.fulfill({ status: 204 })
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`)
      return route.abort()
    })
    await page.goto(`${origin}/${lang}/dashboard/${clientId}/studio?liveChat=1&thread=${threadId}`)
    await expect.poll(async () => pageErrors.length ? pageErrors.join('\n') : page.locator('.as-live-result').count()).toBe(3)
    await page.reload()
    await expect(page.locator('.as-live-result')).toHaveCount(3)
    await expectReadable(page, page.getByText(savedAnswer, { exact: true }))
    expect(answerRequests).toBe(0)

    await page.locator('#studio-composer').fill('Continue this saved discussion.')
    await page.locator('#studio-composer').press('Enter')
    await answerStarted
    release()
    await expectReadable(page, page.getByText(completedAnswer, { exact: true }))
    expect(answerRequests).toBe(1)
    expect(pageErrors).toEqual([])
    expect(unexpected).toEqual([])
  })
}
