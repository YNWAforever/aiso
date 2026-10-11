import { afterAll, describe, expect, it } from 'vitest'
import { writeAdminFixture } from './admin-fixture-writer'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { AdminDirectory } from '@/components/admin/AdminDirectory'
import { SchemaHealthPanel } from '@/components/admin/SchemaHealthPanel'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
afterAll(writeAdminFixture)

describe('platform administration UI', () => {
  it.each(['en', 'zh-HK'])('explains a missing schema separately from user data (%s)', lang => {
    const html = renderToStaticMarkup(<NextIntlClientProvider locale={lang} messages={lang === 'en' ? en : zh} timeZone="UTC"><SchemaHealthPanel health={{ status: 'attention', checkedAt: '2026-10-12T00:00:00Z', checks: [{ key: 'monitoring', missing: ['pulse_runs.purpose'] }] }} /></NextIntlClientProvider>)
    expect(html).toContain('pulse_runs.purpose')
    expect(html).toContain(lang === 'en' ? 'Monitoring and reruns' : '監測及重新執行')
    expect(html).toContain(lang === 'en' ? 'This does not verify migrations' : '此檢查不代表 migration')
    expect(html).not.toContain('<button') // diagnosis is never a migration action
  })
  it.each(['en', 'zh-HK'])('offers searchable business datasets and explicit loading (%s)', lang => {
    const html = renderToStaticMarkup(<NextIntlClientProvider locale={lang} messages={lang === 'en' ? en : zh} timeZone="UTC"><AdminDirectory lang={lang} query={{ view: 'users', page: 1, q: '', accountId: null }} /></NextIntlClientProvider>)
    expect(html).toContain('name="q"')
    expect(html).toContain('view=brands')
    expect(html).toContain('view=observations')
    expect(html).toContain('role="status"')
    expect(html).toContain('/admin/billing')
    expect(html).not.toContain('/en/admin')
  })
})
