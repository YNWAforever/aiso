import { expect, it } from 'vitest'
import { renderWithIntl } from '@/__tests__/helpers/intl'
import { StudioSectionHeader } from '@/components/dashboard/StudioSectionHeader'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const clientId = '11111111-1111-4111-8111-111111111111'
const base = `/${clientId}/studio`

it.each(['en', 'zh-HK'])('renders the five Chat sections with one active tab in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio
  const rendered = renderWithIntl(<StudioSectionHeader clientId={clientId} active="weekly" title={copy.weekly.title} description={copy.weekly.subtitle} showTabs />, lang)
  const html = rendered.replaceAll('&amp;', '&')
  const localeBase = `/${lang}/dashboard${base}`
  const tabs = [[copy.threadsTitle, 'threads'], [copy.nav.weekly, 'weekly'], [copy.nav.documents, 'documents'], [copy.nav.connections, 'connections'], [copy.nav.tools, 'tools']] as const
  for (const [label, path] of tabs) {
    expect(html).toContain(`href="${localeBase}/${path}"`)
    expect(html).toContain(label)
  }
  expect(html).toContain(copy.sections.label)
  expect(html).toContain(copy.sections.backToChat)
  expect(html).toContain(`href="${localeBase}"`)
  expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  expect(html).toContain(`<h1>${copy.weekly.title}</h1>`)
})

it('keeps the legacy shell free of a second section nav', () => {
  const copy = en.conversationStudio
  const html = renderWithIntl(<StudioSectionHeader clientId={clientId} active="threads" title={copy.threadsTitle} description={copy.views.threads.description} />)
  expect(html).not.toContain(copy.sections.label)
  expect(html).not.toContain('aria-current')
  expect(html).toContain(copy.sections.backToChat)
})
