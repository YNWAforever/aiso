import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import {
  expect,
  test,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
  type Response as PlaywrightResponse,
} from '@playwright/test'
import enMessages from '../messages/en.json'
import zhMessages from '../messages/zh-HK.json'

const LOCALES = ['en', 'zh-HK'] as const
const VIEWPORTS = [
  { name: 'mobile', viewport: { width: 375, height: 812 } },
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
] as const
const TARGETS = LOCALES.flatMap(locale =>
  VIEWPORTS.map(viewport => ({ locale, ...viewport })),
)
const FIXTURE_ENV = 'PLAYWRIGHT_CLIENT_REPORT_FIXTURE'
const FIXTURE_PREREQUISITES = [
  'an isolated non-production database with migration 027 applied',
  'a local REPORT_SHARE_SECRET of at least 32 characters',
  'NEXT_PUBLIC_APP_URL matching BASE_URL',
  'four isolated active-Pro clients with baseline/comparable scans',
  'Free and Basic clients for entitlement denial',
  'authenticated Playwright storage-state files',
].join('; ')

type Locale = (typeof LOCALES)[number]
type ViewportName = (typeof VIEWPORTS)[number]['name']
type MessageNamespace = Record<string, string>

type ProMatrixFixture = {
  key: `${Locale}-${ViewportName}`
  storageState: string
  clientId: string
  baselineScanId: string
  comparableScanId: string
  clientName: string
  domain: string
  logoUrl: string
  logoOrigin: string
}

type IneligibleFixture = {
  plan: 'free' | 'basic'
  locale: Locale
  storageState: string
  clientId: string
  scanId: string
}

type ClientReportFixtureFile = {
  pro: ProMatrixFixture[]
  ineligible: IneligibleFixture[]
}

type LoadedFixtures = {
  root: string
  value: ClientReportFixtureFile
}

type ReportListItem = {
  id?: unknown
  viewCount?: unknown
  ctaClickCount?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function loadFixtures(): LoadedFixtures | null {
  const configuredPath = process.env[FIXTURE_ENV]
  if (!configuredPath) return null
  const absolutePath = isAbsolute(configuredPath)
    ? configuredPath
    : resolve(process.cwd(), configuredPath)
  if (!existsSync(absolutePath)) {
    throw new Error(`${FIXTURE_ENV} points to a missing file`)
  }

  const parsed: unknown = JSON.parse(readFileSync(absolutePath, 'utf8'))
  if (!isRecord(parsed) || !Array.isArray(parsed.pro) || !Array.isArray(parsed.ineligible)) {
    throw new Error(`${FIXTURE_ENV} must contain pro and ineligible arrays`)
  }
  return {
    root: dirname(absolutePath),
    value: parsed as ClientReportFixtureFile,
  }
}

const fixtures = loadFixtures()

function copyFor(locale: Locale) {
  const messages = locale === 'en' ? enMessages : zhMessages
  return {
    pricing: messages.pricing as MessageNamespace,
    reports: messages.reports as MessageNamespace,
    branding: messages.reportBranding as MessageNamespace,
  }
}

function storageStatePath(root: string, configuredPath: string): string {
  return isAbsolute(configuredPath) ? configuredPath : resolve(root, configuredPath)
}

async function authenticatedContext(
  browser: Browser,
  target: (typeof TARGETS)[number],
  storageState: string,
): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    viewport: target.viewport,
    storageState,
    permissions: ['clipboard-read', 'clipboard-write'],
  })
}

function monitorRuntimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', error => errors.push(error.message))
  return errors
}

async function expectNoDocumentOverflow(page: Page) {
  const width = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(width.scroll).toBeLessThanOrEqual(width.client)
}

async function responseJson(response: PlaywrightResponse | APIResponse): Promise<Record<string, unknown>> {
  const value: unknown = await response.json()
  if (!isRecord(value)) throw new Error('Expected an object response')
  return value
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || !value) throw new Error(`Missing response field: ${key}`)
  return value
}

function reportIdFromCreate(body: Record<string, unknown>): string {
  const report = body.report
  if (!isRecord(report)) throw new Error('Create response did not include a report DTO')
  return requireString(report, 'id')
}

async function reportMetrics(context: BrowserContext, clientId: string, reportId: string) {
  const response = await context.request.get(`/api/clients/${encodeURIComponent(clientId)}/reports`)
  expect(response.ok()).toBe(true)
  const body = await responseJson(response)
  const reports = body.reports
  if (!Array.isArray(reports)) throw new Error('Report list response did not include reports')
  const report = reports.find(item => isRecord(item) && item.id === reportId) as ReportListItem | undefined
  if (!report) throw new Error('Published report missing from report list')
  return report
}

function assertPublicPayloadSafe(html: string) {
  const forbiddenMarkers = [
    'account_id',
    'accountId',
    'client_id',
    'clientId',
    'source_scan_id',
    'sourceScanId',
    'previous_scan_id',
    'previousScanId',
    'SUPABASE_SERVICE_ROLE_KEY',
    'REPORT_SHARE_SECRET',
    'OPENROUTER_API_KEY',
  ]
  if (forbiddenMarkers.some(marker => html.includes(marker))) {
    throw new Error('client payload excludes private fields and secrets')
  }
  const localSecret = process.env.REPORT_SHARE_SECRET
  if (localSecret && html.includes(localSecret)) {
    throw new Error('client payload exposed the configured report-share secret')
  }
}

async function neutralNotFound(context: BrowserContext, url: string): Promise<string> {
  const response = await context.request.get(url, { maxRedirects: 0 })
  expect(response.status()).toBe(404)
  const body = await response.text()
  expect(body.toLowerCase()).not.toMatch(
    /revoked|signature|share version|client_reports_unavailable|unpublished|downgraded/,
  )
  return body
}

test.describe.configure({ mode: 'serial' })

test.describe('Client report commercial truth', () => {
  for (const target of TARGETS) {
    test(`${target.locale} pricing truth at ${target.viewport.width}x${target.viewport.height}`, async ({ browser }) => {
      const context = await browser.newContext({
        baseURL: process.env.BASE_URL || 'http://localhost:3000',
        viewport: target.viewport,
      })
      const page = await context.newPage()
      const copy = copyFor(target.locale)

      await page.goto(`/${target.locale}/pricing`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByText(copy.pricing.row_client_report, { exact: true }).first()).toBeVisible()
      await expect(page.getByText(copy.pricing.row_pdf, { exact: true })).toHaveCount(0)
      await expectNoDocumentOverflow(page)
      await context.close()
    })
  }
})

test.describe('Pro client report lifecycle matrix', () => {
  for (const target of TARGETS) {
    test(`${target.locale} ${target.name} report lifecycle`, async ({ browser }) => {
      const fixture = fixtures?.value.pro.find(item => item.key === `${target.locale}-${target.name}`)
      if (!fixtures || !fixture) {
        test.skip(true, `${FIXTURE_ENV} required: ${FIXTURE_PREREQUISITES}`)
        return
      }

      const storageState = storageStatePath(fixtures.root, fixture.storageState)
      if (!existsSync(storageState)) throw new Error('Configured Pro storage-state file is missing')
      const context = await authenticatedContext(browser, target, storageState)
      const page = await context.newPage()
      const runtimeErrors = monitorRuntimeErrors(page)
      const copy = copyFor(target.locale)
      const agencyName = `Fimmick E2E ${target.locale} ${target.name}`
      const contactLabel = `Contact ${agencyName}`
      const contactUrl = 'mailto:client-reports-e2e@example.com'
      const firstSummary = `Reviewed ${target.locale} client report summary grounded in the stored comparable scan evidence.`
      const updatedSummary = `Published update for ${target.locale} after a second explicit review of the stored scan evidence.`

      await test.step('branding save and initials fallback', async () => {
        await page.goto(`/${target.locale}/dashboard/settings#report-branding`, { waitUntil: 'domcontentloaded' })
        await page.getByLabel(copy.branding.agency_name).fill(agencyName)
        await page.getByLabel(copy.branding.logo_url).fill('')
        await page.getByLabel(copy.branding.primary_color).fill('#1D4ED8')
        await page.getByLabel(copy.branding.contact_label).fill(contactLabel)
        await page.getByLabel(copy.branding.contact_url).fill(contactUrl)
        await expect(page.getByLabel(copy.branding.initials_fallback)).toBeVisible()
        await page.getByLabel(copy.branding.logo_url).fill(fixture.logoUrl)
        await page.getByRole('button', { name: copy.branding.save }).click()
        await expect(page.getByText(copy.branding.saved, { exact: true })).toBeVisible()
      })

      await test.step('eligible scan CTA', async () => {
        await page.goto(
          `/${target.locale}/dashboard/${fixture.clientId}/result/${fixture.baselineScanId}`,
          { waitUntil: 'domcontentloaded' },
        )
        const create = page.getByRole('link', { name: copy.reports.create_client_report })
        await expect(create).toBeVisible()
        await create.click()
        await expect(page.getByRole('heading', { name: copy.reports.new_title })).toBeVisible()
      })

      await test.step('baseline draft', async () => {
        await page.getByRole('button', { name: copy.reports.review_report }).click()
        await expect(page.getByText(copy.reports.comparison_baseline, { exact: true })).toBeVisible()
      })

      let reportId = ''
      await page.goto(
        `/${target.locale}/dashboard/${fixture.clientId}/reports/new?scanId=${fixture.comparableScanId}`,
        { waitUntil: 'domcontentloaded' },
      )
      const summary = page.getByLabel(copy.reports.executive_summary)
      const deterministicSummary = await summary.inputValue()

      await test.step('AI failure preserves editable deterministic summary', async () => {
        await page.route('**/api/client-reports/*/ai-summary', route => route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'service_unavailable' }),
        }))
        const created = page.waitForResponse(response =>
          response.request().method() === 'POST'
          && new URL(response.url()).pathname === `/api/clients/${fixture.clientId}/reports`,
        )
        await page.getByRole('button', { name: copy.reports.polish_ai }).click()
        const createResponse = await created
        expect(createResponse.status()).toBe(201)
        reportId = reportIdFromCreate(await responseJson(createResponse))
        await expect(page.getByText(copy.reports.ai_fallback, { exact: true })).toBeVisible()
        await expect(summary).toHaveValue(deterministicSummary)
        await expect(summary).toBeEditable()
        await page.unroute('**/api/client-reports/*/ai-summary')
      })

      await test.step('comparable draft with improvement and regression', async () => {
        await summary.fill(firstSummary)
        await page.getByRole('button', { name: copy.reports.review_report }).click()
        await expect(page.getByText(copy.reports.change_improved, { exact: true }).first()).toBeVisible()
        await expect(page.getByText(copy.reports.change_regressed, { exact: true }).first()).toBeVisible()
      })

      let publishedUrl = ''
      await test.step('manual edit, preview, first publish, copy, and open', async () => {
        await expect(page.getByText(firstSummary, { exact: true })).toBeVisible()
        await page.getByRole('button', { name: copy.reports.continue_publish }).click()
        page.once('dialog', dialog => dialog.accept())
        const published = page.waitForResponse(response =>
          response.request().method() === 'POST'
          && new URL(response.url()).pathname === `/api/client-reports/${reportId}/publish`,
        )
        await page.getByRole('button', { name: copy.reports.publish_first }).click()
        const publishResponse = await published
        expect(publishResponse.ok()).toBe(true)
        publishedUrl = requireString(await responseJson(publishResponse), 'signedUrl')
        await expect(page.getByText(copy.reports.published_success, { exact: true })).toBeVisible()

        await page.getByRole('button', { name: copy.reports.copy_link }).click()
        await expect(page.getByText(copy.reports.link_copied, { exact: true })).toBeVisible()
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(publishedUrl)

        const popupPromise = page.waitForEvent('popup')
        await page.getByRole('button', { name: copy.reports.open_link }).click()
        const popup = await popupPromise
        await popup.waitForLoadState('domcontentloaded')
        expect(popup.url()).toBe(publishedUrl)
        await popup.close()
      })

      const publicPage = await context.newPage()
      const publicImageOrigins: string[] = []
      publicPage.on('request', request => {
        if (request.resourceType() === 'image') publicImageOrigins.push(new URL(request.url()).origin)
      })
      const publicResponse = await publicPage.goto(publishedUrl, { waitUntil: 'networkidle' })
      expect(publicResponse?.ok()).toBe(true)
      await expect(publicPage.getByText(firstSummary, { exact: true })).toBeVisible()
      await expect(publicPage.getByText('Powered by Fimmick AISO', { exact: true })).toBeVisible()
      const publicHtml = await publicResponse!.text()
      assertPublicPayloadSafe(publicHtml)
      const applicationOrigin = new URL(process.env.BASE_URL || 'http://localhost:3000').origin
      expect(publicImageOrigins.length).toBeGreaterThan(0)
      expect(publicImageOrigins.every(origin => origin === applicationOrigin)).toBe(true)
      expect(publicImageOrigins).not.toContain(fixture.logoOrigin)

      await test.step('newer draft leaves published version unchanged', async () => {
        await page.getByRole('button', { name: copy.reports.back_to_review }).click()
        await page.getByRole('button', { name: copy.reports.back_to_compose }).click()
        await summary.fill(updatedSummary)
        await page.getByRole('button', { name: copy.reports.save_draft }).click()
        await expect(page.getByText(copy.reports.saved, { exact: true })).toBeVisible()
        await publicPage.reload({ waitUntil: 'networkidle' })
        await expect(publicPage.getByText(firstSummary, { exact: true })).toBeVisible()
        await expect(publicPage.getByText(updatedSummary, { exact: true })).toHaveCount(0)
      })

      await test.step('publish update changes public content', async () => {
        await page.getByRole('button', { name: copy.reports.review_report }).click()
        await page.getByRole('button', { name: copy.reports.continue_publish }).click()
        page.once('dialog', dialog => dialog.accept())
        await page.getByRole('button', { name: copy.reports.publish_update }).click()
        await expect(page.getByText(copy.reports.published_success, { exact: true })).toBeVisible()
        await publicPage.reload({ waitUntil: 'networkidle' })
        await expect(publicPage.getByText(updatedSummary, { exact: true })).toBeVisible()
      })

      await test.step('counters and contact redirect', async () => {
        await expect.poll(async () => {
          const report = await reportMetrics(context, fixture.clientId, reportId)
          return typeof report.viewCount === 'number' ? report.viewCount : -1
        }).toBeGreaterThanOrEqual(1)

        const contactLink = publicPage.getByRole('link', { name: contactLabel })
        const contactHref = await contactLink.getAttribute('href')
        expect(contactHref).toBeTruthy()
        const expectedContactUrl = new URL(contactHref!, publishedUrl).toString()
        const redirectPromise = publicPage.waitForResponse(
          response => response.url() === expectedContactUrl,
        )
        await contactLink.click()
        const redirect = await redirectPromise
        expect([302, 303, 307, 308]).toContain(redirect.status())
        expect(redirect.headers().location).toBe(contactUrl)
        await expect.poll(async () => {
          const report = await reportMetrics(context, fixture.clientId, reportId)
          return typeof report.ctaClickCount === 'number' ? report.ctaClickCount : -1
        }).toBeGreaterThanOrEqual(1)
      })

      let rotatedUrl = ''
      await test.step('rotate and revoke invalidate old links', async () => {
        page.once('dialog', dialog => dialog.accept())
        const rotated = page.waitForResponse(response =>
          response.request().method() === 'POST'
          && new URL(response.url()).pathname === `/api/client-reports/${reportId}/rotate-link`,
        )
        await page.getByRole('button', { name: copy.reports.rotate_link }).click()
        const rotateResponse = await rotated
        rotatedUrl = requireString(await responseJson(rotateResponse), 'signedUrl')
        expect(rotatedUrl).not.toBe(publishedUrl)
        await neutralNotFound(context, publishedUrl)
        const active = await context.request.get(rotatedUrl)
        expect(active.ok()).toBe(true)

        page.once('dialog', dialog => dialog.accept())
        await page.getByRole('button', { name: copy.reports.revoke_report }).click()
        await expect(page.getByText(copy.reports.revoked_success, { exact: true })).toBeVisible()
        await neutralNotFound(context, rotatedUrl)
      })

      await test.step('invalid public link is a neutral 404', async () => {
        const invalid = new URL(
          `/${target.locale}/r/${'x'.repeat(32)}?v=1&s=${'0'.repeat(64)}`,
          process.env.BASE_URL || 'http://localhost:3000',
        ).toString()
        const invalidBody = await neutralNotFound(context, invalid)
        expect(invalidBody).not.toContain(fixture.clientName)
        expect(invalidBody).not.toContain(fixture.domain)
      })

      await test.step('keyboard focus, live announcements, and target sizes', async () => {
        await expect(page.locator('[aria-live="polite"]').first()).toBeAttached()
        await page.getByRole('button', { name: copy.reports.back_to_review }).focus()
        await expect(page.getByRole('button', { name: copy.reports.back_to_review })).toBeFocused()
        const undersized = await page.locator('main button:visible, main a:visible').evaluateAll(elements =>
          elements.filter(element => {
            const bounds = element.getBoundingClientRect()
            return bounds.width < 44 || bounds.height < 44
          }).length,
        )
        expect(undersized).toBe(0)
      })

      await test.step('no console errors or horizontal overflow', async () => {
        await expectNoDocumentOverflow(page)
        await expectNoDocumentOverflow(publicPage)
        expect(runtimeErrors).toEqual([])
      })

      await publicPage.close()
      await context.close()
    })
  }
})

test.describe('Free and Basic report gates', () => {
  test('Free and Basic API denial and upgrade state', async ({ browser }) => {
    if (!fixtures) {
      test.skip(true, `${FIXTURE_ENV} required: ${FIXTURE_PREREQUISITES}`)
      return
    }

    for (const plan of ['free', 'basic'] as const) {
      const fixture = fixtures.value.ineligible.find(item => item.plan === plan)
      if (!fixture) throw new Error(`Missing ${plan} fixture in ${FIXTURE_ENV}`)
      const viewport = plan === 'free' ? VIEWPORTS[0] : VIEWPORTS[1]
      const target = { locale: fixture.locale, ...viewport }
      const storageState = storageStatePath(fixtures.root, fixture.storageState)
      if (!existsSync(storageState)) throw new Error(`Configured ${plan} storage-state file is missing`)
      const context = await authenticatedContext(browser, target, storageState)
      const page = await context.newPage()
      const copy = copyFor(fixture.locale)

      await test.step('ineligible scan CTA', async () => {
        await page.goto(
          `/${fixture.locale}/dashboard/${fixture.clientId}/result/${fixture.scanId}`,
          { waitUntil: 'domcontentloaded' },
        )
        const create = page.getByRole('link', { name: copy.reports.create_client_report })
        await expect(create).toBeVisible()
        await create.click()
        await expect(page.getByRole('heading', { name: copy.reports.upgrade_title })).toBeVisible()
      })

      const response = await context.request.post(
        `/api/clients/${encodeURIComponent(fixture.clientId)}/reports`,
        {
          data: {
            scanId: fixture.scanId,
            locale: fixture.locale,
            executiveSummary: 'This browser-submitted summary must not bypass the paid entitlement boundary.',
          },
        },
      )
      expect(response.status()).toBe(403)
      expect(await response.json()).toEqual({ error: 'client_reports_unavailable' })
      await context.close()
    }
  })
})