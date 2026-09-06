import 'server-only'
import { serializeDraftSnapshot } from '@/lib/opportunities/fingerprint'
import type { DraftSnapshotV1, OpportunityLocale, SourceEvidence, Suggestion } from '@/lib/opportunities/types'
import { parseDraftEdit } from './schema'

/** Shared server-side eligibility and locale copy. Never accepts browser-generated text. */
export function buildInitialDraftSnapshot(suggestion:Suggestion,source:SourceEvidence,locale:OpportunityLocale):DraftSnapshotV1 {
 const chinese=locale==='zh-HK'
 const title=suggestion.source.kind==='pulse-metric' ? (chinese?'檢視問題內容覆蓋':'Review question coverage') : (chinese?`檢視網站檢查：${suggestion.args.checkKey}`:`Review website check: ${suggestion.args.checkKey}`)
 const action=suggestion.source.kind==='pulse-metric'
  ? (chinese?`檢視與「${suggestion.args.question}」相關的內容。在 ${suggestion.args.platform} 保留的回答中未提及品牌；先核對內容及證據，再決定下一步。`:`Review content relevant to “${suggestion.args.question}”. The retained ${suggestion.args.platform} answer did not mention the brand; review the content and evidence before deciding next steps.`)
  : (chinese?`檢視 ${suggestion.args.checkKey} 的保留證據及限制，並調查警告或未通過的檢查結果。`:`Review the retained evidence and limitations for ${suggestion.args.checkKey}, and investigate the warning or failed check.`)
 const normalized=parseDraftEdit({title,action,notes:'',expectedRevision:1})
 if(suggestion.evidence.kind==='pulse-metric'&&source.kind!=='pulse-metric')throw new TypeError('Source kind mismatch')
 const evidence=suggestion.evidence.kind==='pulse-metric'
  ? {...suggestion.evidence,answerDigest:(source as Extract<SourceEvidence,{kind:'pulse-metric'}>).answerDigest} : suggestion.evidence
 const snapshot:DraftSnapshotV1={schemaVersion:1,source:suggestion.source,ruleVersion:suggestion.ruleVersion,evidence,limitations:suggestion.limitations,titleKey:suggestion.titleKey,actionKey:suggestion.actionKey,args:suggestion.args,locale,initialTitle:normalized.title,initialAction:normalized.action}
 serializeDraftSnapshot(snapshot)
 // Pretty JSON adds at least all separators PostgreSQL adds to JSONB text. A conservative
 // byte upper bound lets the read model disable oversized candidates before a save attempt.
 if(Buffer.byteLength(JSON.stringify(snapshot,null,1),'utf8')>65536)throw new RangeError('Limited evidence')
 return snapshot
}
