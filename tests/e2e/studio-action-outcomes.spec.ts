import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'
import { composeSavedReply } from '../../lib/conversation-studio/reply'
import { HOME_TASKS } from '../../lib/conversation-studio/home'
import { emptyStudioEvidence, savedStudioScan } from '../../__tests__/helpers/studio-evidence'
const client = '11111111-1111-4111-8111-111111111111', scanB = '33333333-3333-4333-8333-333333333333', threadId = '44444444-4444-4444-8444-444444444444'
const threads = `/api/dashboard/clients/${client}/studio/threads`
const scanA = savedStudioScan!.id
async function fixture(page: Page, lang: string, createLost = false, appendRetryGate?: Promise<void>) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const directory = process.env.STUDIO_HTML_DIR ?? '.next/component-fixtures/STUDIO'
  await page.route('**/*', route => route.abort())
  await page.route('**/api/funnel-events', route => route.fulfill({ status: 204 }))
  await page.route(`https://studio-actions.fixture/${lang}*`, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${lang}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Studio action fixture</title><style>${readFileSync(`${directory}/build.css`, 'utf8')}</style></head><body><div id="root"></div><script>${readFileSync(`${directory}/fixture.js`, 'utf8')}</script></body></html>` }))
  let creates = 0
  const appends: string[] = []
  await page.route(`**${threads}`, route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { threads: [], truncated: false } })
    creates++
    if (createLost) return route.abort('failed')
    return route.fulfill({ status: 201, json: { thread: { ...route.request().postDataJSON(), id: threadId, createdAt: '2026-11-13T08:00:00Z', updatedAt: '2026-11-13T08:00:00Z', turnCount: 0, visibility: 'private', pinned: false, archived: false, mine: true, branchOf: null } } })
  })
  await page.route(`**${threads}/${threadId}/turns`, async route => {
    appends.push(route.request().postData()!)
    if (appends.length === 1) return route.abort('failed')
    if (appendRetryGate) await appendRetryGate
    const input = route.request().postDataJSON()
    return route.fulfill({ json: { turn: { id: '55555555-5555-4555-8555-555555555555', position: 0, prompt: input.prompt, task: input.task, reply: composeSavedReply(input.prompt, HOME_TASKS.improve.capability, emptyStudioEvidence), attached: null, live: null, receipts: [], createdAt: '2026-11-13T08:00:00Z' } } })
  })
  await page.goto(`https://studio-actions.fixture/${lang}?actions=1&scan=1`)
  return { copy: (lang === 'en' ? en : zh).conversationStudio, appends, creates: () => creates }
}
for (const lang of ['en', 'zh-HK']) {
  for (const width of [320,390,768,1440]) for (const dark of [false,true]) test(`Studio action keyboard and outcome ${lang} ${width} ${dark?'dark':'light'}`,async({page})=>{
    await page.setViewportSize({width,height:900})
    const {copy,creates,appends}=await fixture(page,lang,true)
    await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),dark)
    const paid:string[]=[]
    page.on('request',request=>{if(request.method()==='POST'&&(/\/api\/scan$|\/agents\/generate$|\/months\//).test(new URL(request.url()).pathname))paid.push(new URL(request.url()).pathname)})
    let release!:()=>void
    const gate=new Promise<void>(resolve=>{release=resolve})
    await page.route('**/api/scan',async route=>{await gate;await route.fulfill({json:{id:scanB}})})
    for(const skill of ['scan_brand','improve_page','monthly_report']) {
      const card=page.locator(`[data-studio-action="${skill}"]`),open=card.getByRole('button',{name:copy.actions.open,exact:true})
      await open.focus();await page.keyboard.press('Enter')
      const panel=card.getByRole('group')
      await expect(panel).toBeFocused()
      expect((await panel.getByRole('button',{name:copy.actions.runNow,exact:true}).boundingBox())?.height).toBeGreaterThanOrEqual(44)
      expect((await panel.getByRole('button',{name:copy.actions.cancel,exact:true}).boundingBox())?.height).toBeGreaterThanOrEqual(44)
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
      await page.keyboard.press('Escape');await expect(open).toBeFocused()
      await page.keyboard.press('Enter');await expect(panel).toBeFocused()
      await panel.getByRole('button',{name:copy.actions.cancel,exact:true}).focus();await page.keyboard.press('Enter')
      await expect(open).toBeFocused()
    }
    expect(paid).toEqual([]);expect(creates()).toBe(0);expect(appends).toHaveLength(0)
    const scan=page.locator('[data-studio-action="scan_brand"]')
    await scan.getByRole('button',{name:copy.actions.open,exact:true}).click()
    expect((await new AxeBuilder({page}).analyze()).violations).toEqual([])
    await scan.getByRole('button',{name:copy.actions.runNow,exact:true}).focus();await page.keyboard.press('Enter')
    await expect(scan.getByRole('heading',{level:3})).toBeFocused()
    const question=page.locator('textarea').first();await question.focus()
    release()
    await expect(scan.getByText(copy.actions.save.unknown,{exact:true})).toBeVisible()
    await expect(question).toBeFocused()
    expect(paid).toEqual(['/api/scan']);expect(creates()).toBe(1);expect(appends).toHaveLength(0)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    expect((await new AxeBuilder({page}).analyze()).violations).toEqual([])
  })
  test(`scan outcome stays exact and failed append retries only the original save ${lang}`, async ({ page }) => {
    let finishAppend!: () => void
    const appendGate = new Promise<void>(resolve => { finishAppend = resolve })
    const { copy, appends, creates } = await fixture(page, lang, false, appendGate)
    let paid = 0, finish!: () => void
    const gate = new Promise<void>(resolve => { finish = resolve })
    await page.route('**/api/scan', async route => { paid++; await gate; await route.fulfill({ json: { id: scanB } }) })
    const card = page.locator('[data-studio-action="scan_brand"]'), month = page.locator('[data-studio-action="monthly_report"]')
    await card.getByRole('button', { name: copy.actions.open, exact: true }).click()
    await card.getByRole('button', { name: copy.actions.runNow, exact: true }).click()
    await expect(month.getByRole('button', { name: copy.actions.open, exact: true })).toBeDisabled()
    expect(paid).toBe(1)
    finish()
    await expect(card.getByText(copy.actions.save.retry, { exact: true })).toBeVisible()
    await expect(card.getByRole('link', { name: copy.actions.openResult })).toHaveAttribute('href', `/en/dashboard/${client}?step=results&scanId=${scanB}`.replace('/en/', `/${lang}/`))
    await expect(month.getByText(copy.skills.monthly_report.done, { exact: true })).toHaveCount(0)
    await card.getByRole('button', { name: copy.actions.retrySave }).focus()
    await page.keyboard.press('Enter')
    await expect(card.getByRole('heading', { level: 3 })).toBeFocused()
    const question = page.locator('textarea').first()
    await question.focus()
    finishAppend()
    await expect(card.getByText(copy.actions.save.saved, { exact: true })).toBeVisible()
    await expect(question).toBeFocused()
    expect(appends).toHaveLength(2); expect(appends[1]).toBe(appends[0])
    expect(JSON.parse(appends[0]).prompt).toContain(scanB)
    expect(JSON.parse(appends[0]).requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(creates()).toBe(1); expect(paid).toBe(1)
    await expect(card.getByRole('button', { name: copy.actions.runNow })).toHaveCount(0)
  })
  test(`lost thread create acknowledgement stays unknown without recreating ${lang}`, async ({ page }) => {
    const { copy, appends, creates } = await fixture(page, lang, true)
    let paid = 0
    await page.route('**/api/scan', route => { paid++; return route.fulfill({ json: { id: scanB } }) })
    const card = page.locator('[data-studio-action="scan_brand"]')
    await card.getByRole('button', { name: copy.actions.open, exact: true }).click()
    await card.getByRole('button', { name: copy.actions.runNow, exact: true }).click()
    await expect(card.getByText(copy.actions.save.unknown, { exact: true })).toBeVisible()
    await expect(card.getByRole('link', { name: copy.actions.reloadHistory })).toHaveAttribute('href', `/${lang}/dashboard/${client}/studio/threads`)
    await expect(card.getByRole('button', { name: copy.actions.retrySave })).toHaveCount(0)
    expect(paid).toBe(1); expect(creates()).toBe(1); expect(appends).toHaveLength(0)
  })
  test(`generation 202 is pending for submitted scan and saves no completed conversation ${lang}`, async ({ page }) => {
    const { copy, appends, creates } = await fixture(page, lang)
    let paid = 0
    await page.route(`**/api/clients/${client}/agents/generate`, route => { paid++; expect(route.request().postDataJSON()).toEqual({ scanId: scanA }); return route.fulfill({ status: 202, json: { scanId: scanA, state: 'running' } }) })
    const card = page.locator('[data-studio-action="improve_page"]')
    await card.getByRole('button', { name: copy.actions.open, exact: true }).click()
    await card.getByRole('button', { name: copy.actions.runNow, exact: true }).click()
    await expect(card.getByText(copy.actions.pending, { exact: true })).toBeVisible()
    await expect(card.getByRole('link', { name: copy.actions.checkRecords })).toHaveAttribute('href', `/${lang}/dashboard/${client}?step=improve&scanId=${scanA}`)
    expect(paid).toBe(1); expect(creates()).toBe(0); expect(appends).toHaveLength(0)
  })
  test(`month identity is frozen before HKT rollover and append retry ${lang}`, async ({ page }) => {
    const { copy, appends, creates } = await fixture(page, lang)
    await page.clock.setFixedTime(new Date('2026-11-30T15:59:59Z'))
    let paid = 0
    await page.route(`**/api/clients/${client}/months/*`, route => { paid++; expect(route.request().url()).toMatch(/\/months\/2026-11$/); return route.fulfill({ json: { recorded: [] } }) })
    const card = page.locator('[data-studio-action="monthly_report"]')
    await card.getByRole('button', { name: copy.actions.open, exact: true }).click()
    await page.clock.setFixedTime(new Date('2026-11-30T16:00:01Z'))
    await card.getByRole('button', { name: copy.actions.runNow, exact: true }).click()
    await expect(card.getByText(copy.actions.save.retry, { exact: true })).toBeVisible()
    await expect(card.getByRole('link', { name: copy.actions.openResult })).toHaveAttribute('href', `/${lang}/dashboard/${client}/month?m=2026-11`)
    await card.getByRole('button', { name: copy.actions.retrySave }).click()
    await expect(card.getByText(copy.actions.save.saved, { exact: true })).toBeVisible()
    expect(appends[1]).toBe(appends[0]); expect(JSON.parse(appends[0]).prompt).toContain('2026-11')
    expect(paid).toBe(1); expect(creates()).toBe(1)
  })
  for (const state of ['lost', 'malformed'] as const) test(`unconfirmed paid scan ${state} is not offered as a safe rerun ${lang}`, async ({ page }) => {
    const { copy, appends, creates } = await fixture(page, lang)
    let paid = 0
    await page.route('**/api/scan', route => { paid++; return state === 'lost' ? route.abort('failed') : route.fulfill({ json: {} }) })
    const card = page.locator('[data-studio-action="scan_brand"]')
    await card.getByRole('button', { name: copy.actions.open, exact: true }).click()
    await card.getByRole('button', { name: copy.actions.runNow, exact: true }).click()
    await expect(card.getByText(copy.actions.unknown, { exact: true })).toBeVisible()
    await expect(card.getByRole('link', { name: copy.actions.checkRecords })).toHaveAttribute('href', `/${lang}/dashboard/${client}?step=results`)
    await expect(card.getByRole('button', { name: copy.actions.runNow })).toHaveCount(0)
    expect(paid).toBe(1); expect(creates()).toBe(0); expect(appends).toHaveLength(0)
  })
}
