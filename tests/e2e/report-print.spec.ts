import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'

// Offline acceptance for the one-page report's PDF, never an authenticated
// route bypass. Generate the HTML by running report-print-fixture.test.tsx
// with AISO_REPORT_HTML_DIR set. "Download PDF" is the browser's print, so
// every state, including the longest text a report accepts, must print to
// exactly one A4 page.
for (const lang of ['en', 'zh-HK'] as const) for (const state of ['sample', 'medium', 'longest', 'legacy']) {
  test(`report ${state} ${lang} prints to one A4 page`, async ({ page, browserName }) => {
    const dir = process.env.AISO_REPORT_HTML_DIR
    const cssPath = process.env.AISO_REPORT_CSS_PATH
    test.skip(!dir || !cssPath, 'Set AISO_REPORT_HTML_DIR using sanitized component artifacts')
    test.skip(browserName !== 'chromium', 'page.pdf is Chromium-only')
    await page.route('**/*', route => route.abort())
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.setContent(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Report print acceptance</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${readFileSync(cssPath!, 'utf8')}</style></head><body><main>${readFileSync(`${dir}/${lang}-${state}.html`, 'utf8')}</main></body></html>`)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    const pdf = (await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })).toString('latin1')
    expect(pdf.match(/\/Type\s*\/Page(?!s)/g)?.length).toBe(1)
    if (state === 'longest') await page.pdf({ path: `${dir}/${lang}-${state}.pdf`, format: 'A4', printBackground: true, preferCSSPageSize: true })
  })
}
