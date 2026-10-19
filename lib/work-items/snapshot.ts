import 'server-only'
import { serializeDraftSnapshot } from '@/lib/opportunities/fingerprint'
import { scanOpportunityCopy } from '@/lib/opportunities/presentation'
import type {
  DraftSnapshotV1,
  OpportunityLocale,
  ReportFindingProvenance,
  SourceEvidence,
  Suggestion,
} from '@/lib/opportunities/types'
import { parseDraftEdit } from './schema'

/** Shared server-side eligibility and locale copy. Never accepts browser-generated text. */
export function buildInitialDraftSnapshot(
  suggestion: Suggestion,
  source: SourceEvidence,
  locale: OpportunityLocale,
  reportFinding?: Omit<ReportFindingProvenance, 'targetOrigin'>,
): DraftSnapshotV1 {
 const chinese=locale==='zh-HK'
 const scanCopy=suggestion.evidence.kind==='scan-check'?scanOpportunityCopy(suggestion.evidence,locale):null
 const title=scanCopy?.title ?? (chinese?'檢視問題內容覆蓋':'Review question coverage')
 let action=suggestion.source.kind==='pulse-metric'
  ? (chinese?`檢視與「${suggestion.args.question}」相關的內容。在 ${suggestion.args.platform} 保留的回答中未提及品牌；先核對內容及證據，再決定下一步。`:`Review content relevant to “${suggestion.args.question}”. The retained ${suggestion.args.platform} answer did not mention the brand; review the content and evidence before deciding next steps.`)
  : scanCopy!.action
 // This editing scaffold contains no inferred business facts.
 if(suggestion.evidence.kind==='scan-check'&&suggestion.evidence.checkKey==='c9_meta_desc'){
  action+=chinese
   ? '\n\n待編輯範本（未套用）：\n<meta name="description" content="[已核實的頁面主題、對象及主要內容]">\n\n替換所有方括號佔位文字，只使用該頁及已確認品牌資料支持的內容。核對目標頁面及現有 description，交由網站負責人套用至該頁 <head>，再檢查頁面原始碼。儲存或確認草稿不會修改網站，亦不代表排名或引用已提升。'
   : '\n\nEditing template (not applied):\n<meta name="description" content="[Verified page topic, audience and main content]">\n\nReplace every bracketed placeholder using only facts supported by that page and confirmed brand details. Verify the target page and its existing description; ask the site owner to apply the reviewed tag in that page’s <head>, then inspect the page source. Saving or confirming this draft does not modify the website or establish a ranking or citation improvement.'
 }
 const normalized=parseDraftEdit({title,action,notes:'',expectedRevision:1})
 if(suggestion.evidence.kind==='pulse-metric'&&source.kind!=='pulse-metric')throw new TypeError('Source kind mismatch')
 const evidence=suggestion.evidence.kind==='pulse-metric'
  ? {...suggestion.evidence,answerDigest:(source as Extract<SourceEvidence,{kind:'pulse-metric'}>).answerDigest} : suggestion.evidence
 if (reportFinding && (suggestion.source.kind !== 'scan-check'
   || reportFinding.findingKey !== suggestion.source.checkKey)) {
  throw new TypeError('Report provenance does not match the selected suggestion')
 }
 const snapshot:DraftSnapshotV1={
  schemaVersion:1, source:suggestion.source, ruleVersion:suggestion.ruleVersion,
  evidence, limitations:suggestion.limitations, titleKey:suggestion.titleKey,
  actionKey:suggestion.actionKey, args:suggestion.args, locale,
  initialTitle:normalized.title, initialAction:normalized.action,
  ...(reportFinding ? {
    reportProvenance: {
      ...reportFinding,
      targetOrigin: suggestion.evidence.kind === 'scan-check'
        ? suggestion.evidence.evaluated.origin : null,
    },
  } : {}),
 }
 serializeDraftSnapshot(snapshot)
 // Pretty JSON adds at least all separators PostgreSQL adds to JSONB text. A conservative
 // byte upper bound lets the read model disable oversized candidates before a save attempt.
 if(Buffer.byteLength(JSON.stringify(snapshot,null,1),'utf8')>65536)throw new RangeError('Limited evidence')
 return snapshot
}
