import { expect, test, type Page } from '@playwright/test'
import { A11Y_LOCALES } from './matrix'

const COPY = {
  en: {
    skip: 'Skip to main content', login: 'Sign in to your dashboard', email: 'Work email',
    google: 'Continue with Google', submit: 'Send Magic Link', success: 'Check your email',
    googleError: 'Could not start Google sign-in. Please try again.',
    emailError: 'Could not send the magic link. Please try again.',
    steps: ["What's your brand name?", 'Your website domain', 'Your industry & region', 'Tell AI what you do'],
    continue: 'Continue', back: 'Back', industry: 'Industry (optional)', region: 'Region (optional)',
    description: 'Brand description', competitors: 'Main competitors', finish: 'Go to my dashboard',
    completeError: 'Something went wrong',
  },
  'zh-HK': {
    skip: '跳至主要內容', login: '登入你的儀表板', email: '工作電郵',
    google: '使用 Google 繼續', submit: '發送登入連結', success: '請查看你的電郵',
    googleError: '無法啟動 Google 登入，請再試一次。',
    emailError: '無法發送登入連結，請再試一次。',
    steps: ['你的品牌名稱是？', '你的網站域名', '你的行業及地區', '讓 AI 了解你的業務'],
    continue: '繼續', back: '返回', industry: '行業（可選）', region: '地區（可選）',
    description: '品牌描述', competitors: '主要競爭對手', finish: '前往我的儀表板',
    completeError: '發生錯誤，請再試一次',
  },
} as const

// All API requests are intercepted before navigation. Unexpected endpoints fail
// closed; these browser contracts never reach Auth, email, or customer writes.
async function mockRequests(page: Page) {
  const state = { magicLinkSucceeds: false, magicLinks: 0, social: 0, completions: 0 }
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let status = 200
    let body: unknown = null
    if (path.endsWith('/sign-in/magic-link')) {
      state.magicLinks += 1
      status = state.magicLinkSucceeds ? 200 : 400
      body = state.magicLinkSucceeds ? {} : { code: 'PROVIDER_UNAVAILABLE', message: 'Mock failure' }
    } else if (path.endsWith('/sign-in/social')) {
      state.social += 1
      status = 400
      body = { code: 'PROVIDER_UNAVAILABLE', message: 'Mock failure' }
    } else if (path === '/api/onboarding/complete') {
      state.completions += 1
      status = 500
      body = {}
    } else if (!path.startsWith('/api/auth/')) {
      await route.abort('blockedbyclient')
      return
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  return state
}

async function activateButtonByKeyboard(page: Page, name: string) {
  const button = page.getByRole('button', { name, exact: true })
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await button.evaluate(element => document.activeElement === element)) break
    await page.keyboard.press('Tab')
  }
  await expect(button).toBeFocused()
  await page.keyboard.press('Enter')
}
async function expectNoOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }))
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1)
}

async function expectShell(page: Page, heading: string, skip: string) {
  const main = page.getByRole('main')
  await expect(main).toHaveCount(1)
  await expect(main).toHaveAttribute('id', 'main-content')
  await expect(main).toHaveAttribute('tabindex', '-1')
  await expect(page.locator('#main-content')).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(main.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible()
  await page.keyboard.press('Tab')
  const link = page.getByRole('link', { name: skip, exact: true })
  await expect(link).toBeFocused()
  await expect(link).toBeInViewport()
  await expect(link).toHaveAttribute('href', '#main-content')
  await page.keyboard.press('Enter')
  await expect(main).toBeFocused()
  await expectNoOverflow(page)
}

async function expectZoomReflow(page: Page) {
  // CSS zoom exercises 200% enlargement and reflow, not browser chrome zoom.
  await page.evaluate(() => { document.documentElement.style.zoom = '2' })
  await expectNoOverflow(page)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.evaluate(() => { document.documentElement.style.zoom = '' })
}

for (const locale of A11Y_LOCALES) {
  const c = COPY[locale]

  test(`login keyboard landmark and reflow ${locale}`, async ({ page }) => {
    await mockRequests(page)
    await page.goto(`/${locale}/auth/login`, { waitUntil: 'networkidle' })
    await expectShell(page, c.login, c.skip)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: c.google, exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('textbox', { name: c.email, exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: c.submit, exact: true })).toBeFocused()
    await expectZoomReflow(page)
  })

  test(`login announces mocked failure and success ${locale}`, async ({ page }) => {
    const requests = await mockRequests(page)
    await page.goto(`/${locale}/auth/login`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: c.google, exact: true }).click()
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(c.googleError)
    const email = page.getByRole('textbox', { name: c.email, exact: true })
    await email.fill('accessibility@example.com')
    await page.getByRole('button', { name: c.submit, exact: true }).click()
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(c.emailError)
    await expect(email).toHaveAccessibleDescription(c.emailError)
    requests.magicLinkSucceeds = true
    await page.getByRole('button', { name: c.submit, exact: true }).click()
    const status = page.getByRole('main').getByRole('status')
    await expect(status).toContainText(c.success)
    await expect(status).toBeFocused()
    await expect(status).toContainText('accessibility@example.com')
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
    expect(requests.social).toBe(1)
    expect(requests.magicLinks).toBe(2)
    await expectNoOverflow(page)
  })

  test(`onboarding keyboard landmark and reflow ${locale}`, async ({ page }) => {
    await mockRequests(page)
    await page.goto(`/${locale}/onboarding`, { waitUntil: 'networkidle' })
    await expectShell(page, c.steps[0], c.skip)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('textbox', { name: c.steps[0], exact: true })).toBeFocused()
    await expectZoomReflow(page)
  })

  test(`onboarding steps retain keyboard focus and announce HTTP failure ${locale}`, async ({ page }) => {
    const requests = await mockRequests(page)
    await page.goto(`/${locale}/onboarding`, { waitUntil: 'networkidle' })
    const firstControls = [
      page.getByRole('textbox', { name: c.steps[0], exact: true }),
      page.getByRole('textbox', { name: c.steps[1], exact: true }),
      page.getByRole('combobox', { name: c.industry, exact: true }),
      page.getByRole('textbox', { name: new RegExp(c.description) }),
    ]
    async function expectStep(step: number) {
      const heading = page.getByRole('heading', { level: 1, name: c.steps[step], exact: true })
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      // Focusing the updated H1 exposes its name to assistive technology and
      // avoids raising the mobile software keyboard until the user tabs.
      await expect(heading).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(firstControls[step]).toBeFocused()
      await expectNoOverflow(page)
    }
    await firstControls[0].fill('Accessibility fixture')
    await firstControls[0].press('Enter')
    await expectStep(1)
    await firstControls[1].fill('example.com')
    await firstControls[1].press('Enter')
    await expectStep(2)
    await page.getByRole('combobox', { name: c.region, exact: true }).selectOption('HK')
    await firstControls[2].selectOption('technology')
    await activateButtonByKeyboard(page, c.continue)
    await expectStep(3)
    const competitor = page.getByRole('textbox', { name: new RegExp(c.competitors) })
    await competitor.fill('Fixture competitor')
    await competitor.press('Enter')
    const remove = page.getByRole('button', {
      name: locale === 'en' ? 'Remove Fixture competitor' : '移除Fixture competitor', exact: true,
    })
    await expect(remove).toBeVisible()
    // Adding clears the input and disables Add, so the next Tab reaches Remove.
    await page.keyboard.press('Tab')
    await expect(remove).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(remove).toHaveCount(0)
    await expectZoomReflow(page)
    for (const step of [2, 1, 0]) {
      await activateButtonByKeyboard(page, c.back)
      await expectStep(step)
    }
    await expect(firstControls[0]).toHaveValue('Accessibility fixture')
    for (const step of [1, 2, 3]) {
      await activateButtonByKeyboard(page, c.continue)
      await expectStep(step)
    }
    await page.getByRole('button', { name: c.finish, exact: true }).click()
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(c.completeError)
    await expect(page.getByRole('button', { name: c.finish, exact: true })).toBeEnabled()
    await expect(page).toHaveURL(new RegExp(`/${locale}/onboarding$`))
    expect(requests.completions).toBe(1)
    await expectNoOverflow(page)
  })
}
