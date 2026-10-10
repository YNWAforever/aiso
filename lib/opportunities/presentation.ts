import { getCheckActionCopy } from '@/lib/checkExplanations'
import type { OpportunityLocale, ScanSuggestionEvidence } from './types'

/** Display copy does not participate in source identity or eligibility fingerprints. */
export function scanOpportunityCopy(evidence: ScanSuggestionEvidence, locale: OpportunityLocale) {
  const copy = getCheckActionCopy(evidence.checkKey, locale)
  const title = copy?.title ?? (locale === 'zh-HK' ? '檢查網站內容' : 'Review website content')
  const step = copy ? `${copy.question} ${copy.nextStep}` : (locale === 'zh-HK' ? '先核對保留證據及限制。' : 'Review the retained evidence and limitations first.')
  const scope = locale === 'zh-HK'
    ? '保留資料只識別網站網域，未保留頁面摘錄。請先在網站定位相關內容，或重新掃描取得頁面證據，再決定修改。'
    : 'The retained evidence identifies the website origin and contains no page excerpts. Locate the relevant content on your site, or scan again for page evidence, before deciding what to change.'
  return { title, action: `${step} ${scope}` }
}
