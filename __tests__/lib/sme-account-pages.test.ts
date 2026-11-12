import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const settings = readFileSync('app/[lang]/dashboard/settings/page.tsx', 'utf8')
const entities = readFileSync('app/[lang]/dashboard/[clientId]/entities/page.tsx', 'utf8')
const sources = readFileSync('app/[lang]/dashboard/[clientId]/sources/page.tsx', 'utf8')

describe('account and brand setup (slice 7)', () => {
  it('shows plan and members first, with staff/Google/report branding behind one Advanced disclosure', () => {
    expect(settings).toContain("isFeatureEnabled, isSmeCopilotUiEnabled")
    expect(settings).toContain("advancedT('advancedTitle')")
    expect(settings).toContain("advancedT('advancedBody')")
    // The advanced panels are defined once and rendered in both branches.
    expect(settings).toContain('const advancedPanels = <>')
    expect(settings).toContain('{advancedPanels}')
    expect(settings.indexOf('<MembersPanel')).toBeLessThan(settings.indexOf('advancedT(\'advancedTitle\')'))
  })

  it('promotes brand setup as the start-here page with a plain-language intro', () => {
    expect(entities).toContain('isSmeCopilotUiEnabled()')
    expect(entities).toContain("t('smeIntroTitle')")
    expect(entities).toContain("t('smeIntroBody')")
  })

  it('gives verified facts a plain-language intro while keeping the workspace', () => {
    expect(sources).toContain('isSmeCopilotUiEnabled()')
    expect(sources).toContain("t('smeIntroTitle')")
    expect(sources).toContain('<SourcePackWorkspace')
  })

  it('has the new copy in both catalogues', () => {
    for (const catalog of [en, zh]) {
      expect(catalog.settings.advancedTitle).toBeTruthy()
      expect(catalog.settings.advancedBody).toBeTruthy()
      expect(catalog.entities.smeIntroTitle).toBeTruthy()
      expect(catalog.entities.smeIntroBody).toBeTruthy()
      expect(catalog.sources.smeIntroTitle).toBeTruthy()
      expect(catalog.sources.smeIntroBody).toBeTruthy()
    }
    expect(zh.settings.advancedTitle).not.toBe(en.settings.advancedTitle)
  })
})
