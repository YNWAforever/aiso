import { expect, it, vi } from 'vitest'
vi.mock('server-only',()=>({}))
import { buildScanEvidence } from '@/lib/scan-evidence'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import { scanOpportunityCopy } from '@/lib/opportunities/presentation'
import { buildInitialDraftSnapshot } from '@/lib/work-items/snapshot'
import { serializeDraftSnapshot } from '@/lib/opportunities/fingerprint'
import type { SourceEvidence } from '@/lib/opportunities/types'

const source:SourceEvidence={kind:'scan-check',scanId:'00000000-0000-4000-8000-000000000003',recordedAt:'2026-09-02T10:00:00Z',envelope:buildScanEvidence({requestedUrl:'https://example.test/private?secret=1',evaluatedUrl:'https://example.test/private',industry:'general_b2b',region:'HK',sitemapSource:'unknown',checks:{c11_faq:{assessment:'fail',collection:'complete'}},collectedAt:'2026-09-02T10:00:00Z',observations:[]})}
it.each(['en','zh-HK'] as const)('T19 new %s scan drafts have concrete actions, unchanged identity and origin-only limits',locale=>{
 const suggestion=deriveSuggestions(source)[0]
 if(suggestion.evidence.kind!=='scan-check')throw new Error('scan expected')
 const identity=JSON.stringify(suggestion)
 const copy=scanOpportunityCopy(suggestion.evidence,locale)
 const snapshot=buildInitialDraftSnapshot(suggestion,source,locale)
 expect(snapshot.initialTitle).toBe(locale==='en'?'Review frequently asked questions':'檢查常見問題內容')
 expect(snapshot.initialAction).toContain(locale==='en'?'contains no page excerpts':'未保留頁面摘錄')
 expect(snapshot.initialAction).toContain(locale==='en'?'scan again':'重新掃描')
 expect(snapshot.initialAction).not.toMatch(/\/private|secret=|rank|排名|%/)
 expect(copy.title).not.toContain('c11_faq')
 expect(JSON.stringify(suggestion)).toBe(identity)
 expect(snapshot.ruleVersion).toBe('scan-check-gap.v1')
 const old={...snapshot,locale:'en' as const,initialTitle:'Review website check: c11_faq',initialAction:'Original English action'}
 expect(JSON.parse(serializeDraftSnapshot(old))).toEqual(old)
})
