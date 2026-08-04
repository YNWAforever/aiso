import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages/en.json'), 'utf8'),
)

describe('ReportBrandingForm', () => {
  it('validates exact Agency branding constraints and paired contact fields', async () => {
    const { validateReportBrandingInput } = await import('@/components/reports/ReportBrandingForm')
    const valid = {
      agencyName: 'Acme Agency',
      logoUrl: 'https://agency.example/logo.webp',
      primaryColor: '#123ABC',
      contactLabel: 'Contact us',
      contactUrl: 'mailto:hello@agency.example',
    }

    expect(validateReportBrandingInput(valid)).toEqual({})
    expect(validateReportBrandingInput({ ...valid, agencyName: '' })).toHaveProperty('agencyName')
    expect(validateReportBrandingInput({ ...valid, agencyName: 'x'.repeat(121) })).toHaveProperty('agencyName')
    expect(validateReportBrandingInput({ ...valid, logoUrl: 'http://agency.example/logo.png' })).toHaveProperty('logoUrl')
    expect(validateReportBrandingInput({ ...valid, primaryColor: '#123' })).toHaveProperty('primaryColor')
    expect(validateReportBrandingInput({ ...valid, contactLabel: '', contactUrl: valid.contactUrl })).toHaveProperty('contactLabel')
    expect(validateReportBrandingInput({ ...valid, contactLabel: valid.contactLabel, contactUrl: '' })).toHaveProperty('contactUrl')
    expect(validateReportBrandingInput({ ...valid, contactUrl: 'javascript:alert(1)' })).toHaveProperty('contactUrl')
  })

  it('renders labeled 44px fields, initials fallback, and mandatory attribution preview', async () => {
    const { ReportBrandingForm } = await import('@/components/reports/ReportBrandingForm')

    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Hong_Kong">
        <ReportBrandingForm
          initialBranding={{
            agencyName: 'Acme Agency',
            logoUrl: null,
            primaryColor: '#123ABC',
            contactLabel: null,
            contactUrl: null,
          }}
        />
      </NextIntlClientProvider>,
    )

    expect(html).toContain('for="report-agency-name"')
    expect(html).toContain('for="report-logo-url"')
    expect(html).toContain('for="report-primary-color"')
    expect(html).toContain('for="report-contact-label"')
    expect(html).toContain('for="report-contact-url"')
    expect(html).toContain('type="url"')
    expect(html).toContain('pattern="^#[0-9A-Fa-f]{6}$"')
    expect(html).toContain('>AA<')
    expect(html).toContain('Powered by Fimmick AISO')
    expect(html).toContain('min-h-11')
    expect(html).toContain('focus-visible:')
  })

  it('keeps save feedback accessible and does not imply white-label output', () => {
    const source = readFileSync(
      join(process.cwd(), 'components/reports/ReportBrandingForm.tsx'),
      'utf8',
    )

    expect(source).toContain('aria-live="polite"')
    expect(source).toContain('/api/report-branding')
    expect(source).toContain("method: 'PUT'")
    expect(source).not.toMatch(/PDF|white-label/i)
  })
})
