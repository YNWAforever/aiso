import { expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { buildScanEvidence } from '@/lib/scan-evidence'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import { buildInitialDraftSnapshot } from '@/lib/work-items/snapshot'

it.each(['en', 'zh-HK'] as const)('prepares an editable metadata template without inventing business facts in %s', locale => {
  const source = { kind: 'scan-check' as const, scanId: '66666666-6666-4666-8666-666666666666', recordedAt: '2026-10-17T00:00:00Z',
    envelope: buildScanEvidence({ requestedUrl: 'https://example.test/private', evaluatedUrl: 'https://example.test/private',
      industry: 'general_b2b', region: 'HK', sitemapSource: 'unknown',
      checks: { c9_meta_desc: { assessment: 'fail', collection: 'complete' } } }) }
  const draft = buildInitialDraftSnapshot(deriveSuggestions(source)[0], source, locale)
  expect(draft.initialAction).toContain('<meta name="description" content="[')
  expect(draft.initialAction).toContain(locale === 'en' ? 'Replace every bracketed placeholder' : '替換所有方括號佔位文字')
  expect(draft.initialAction).not.toContain('/private')
  expect(draft.source).toEqual({ kind: 'scan-check', id: source.scanId, checkKey: 'c9_meta_desc' })
  expect(draft.evidence).toMatchObject({ scanId: source.scanId, checkKey: 'c9_meta_desc', evaluated: { origin: 'https://example.test' } })
})
