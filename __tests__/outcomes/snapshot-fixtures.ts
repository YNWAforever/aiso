import { approvedVersion, eventRow, ID, REQUEST_ID } from '../delivery/fixtures'
export function snapshot() {
 const v = approvedVersion()
 const { id, versionNumber, contentHash, validation, submittedBy, submittedAt, decision, capabilities, ...content } = v
 void capabilities
 return { member: true, owned: true, evaluated_at: '2026-09-15T00:00:00.123456Z',
 version: { id, version_number: versionNumber, content_hash: contentHash, validation, submitter: submittedBy, submitted_at: submittedAt, content,
 account_id: ID, client_id: REQUEST_ID, work_item_id: v.workItemId, draft_revision: v.draftRevision,
 decision_record: { id: REQUEST_ID, ...decision, actor: decision!.decidedBy, actor_id: decision!.decidedBy.profileId, decided_at: decision!.decidedAt, version_id: id, content_hash: contentHash } },
 events: [{ ...eventRow(), account_id: ID, client_id: REQUEST_ID, work_item_id: v.workItemId, content_hash: contentHash, approval_decision_id: REQUEST_ID, approval_decision: 'approved' }] as Record<string, unknown>[],
 scans: [] as unknown[], pulse: [] as unknown[] }
}
export const pulseRow = () => ({ id: REQUEST_ID, question: 'Example?', platform: 'chatgpt', prompt_id: null, created_at: '2026-09-14T00:00:00.123456Z', has_answer: true, brand_mentioned: true })

import { buildScanEvidence, CHECK_VERSIONS } from '@/lib/scan-evidence'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import { freezeReview } from '@/lib/change-sets/validation'
import { draft } from '../change-sets/fixtures'
export function scanEnvelope(collectedAt = '2026-09-01T00:00:00.000Z') {
 return buildScanEvidence({requestedUrl:'https://example.com',evaluatedUrl:'https://example.com',industry:'general_b2b',region:'HK',sitemapSource:'fetched',collectedAt,
 checks:Object.fromEntries(Object.keys(CHECK_VERSIONS).map(k=>[k,{assessment:'fail',collection:'complete'}])),
 observations:[{check:'page',collection:'complete',httpStatus:200,target:{origin:'https://example.com',pathRedacted:false,queryRedacted:false,fragmentRedacted:false,originNormalized:false}}]})
}
export function scanSnapshot() {
 const row = snapshot(), d = draft()
 const suggestion = deriveSuggestions({kind:'scan-check',scanId:ID,recordedAt:'2026-09-01T01:00:00.123456Z',envelope:scanEnvelope()})[0]
 if (suggestion.evidence.kind !== 'scan-check') throw new Error('Expected scan fixture')
 d.evidenceSnapshot = {...d.evidenceSnapshot,source:suggestion.source,ruleVersion:suggestion.ruleVersion,evidence:suggestion.evidence,limitations:suggestion.limitations,titleKey:suggestion.titleKey,actionKey:suggestion.actionKey,args:suggestion.args}
 const frozen = freezeReview(d)
 Object.assign(row.version,{content:frozen.content,content_hash:frozen.contentHash,validation:frozen.validation})
 row.version.decision_record.content_hash = frozen.contentHash
 row.events[0].content_hash = frozen.contentHash
 return row
}
