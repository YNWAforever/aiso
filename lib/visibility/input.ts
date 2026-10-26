import { canonicalOutcomeUrl, object, text, uuid, OutcomeError } from '@/lib/outcome-integrations/input'
import { isPromptLanguage, isPromptMarket } from '@/lib/prompts/context'
function invalid(): never { throw new OutcomeError('INVALID_VISIBILITY_INPUT') }
export const VISIBILITY_SAMPLING = { temperature: 0.2, samplesPerRun: 1, seed: null, version: 'visibility-sampling.v1' } as const
export function parseMonitoredQuery(raw: unknown, domain: string) {
  const body = object(raw, ['promptId','locale','market','persona','intent','funnel','topic','targetUrl','priority','branded','expectedAttributes','competitorIds'])
  if (!isPromptLanguage(body.locale) || !isPromptMarket(body.market) || !['informational','comparison','commercial','transactional','local','support'].includes(String(body.intent))
    || !['awareness','consideration','decision','retention'].includes(String(body.funnel)) || !Number.isInteger(body.priority) || Number(body.priority)<1 || Number(body.priority)>5 || typeof body.branded !== 'boolean'
    || !Array.isArray(body.expectedAttributes) || body.expectedAttributes.length>10 || !Array.isArray(body.competitorIds) || body.competitorIds.length>10) invalid()
  return { promptId:uuid(body.promptId),locale:body.locale,market:body.market,persona:text(body.persona,200),intent:String(body.intent),funnel:String(body.funnel),topic:text(body.topic,120),
    targetUrl:canonicalOutcomeUrl(body.targetUrl,domain),priority:Number(body.priority),branded:body.branded,
    expectedAttributes:[...new Set((body.expectedAttributes as unknown[]).map(value=>text(value,200)))],competitorIds:[...new Set((body.competitorIds as unknown[]).map(uuid))],sampling:VISIBILITY_SAMPLING }
}
export type MonitoredQueryInput = ReturnType<typeof parseMonitoredQuery>
export function parseVisibilityReview(raw: unknown) {
  const body = object(raw,['observationId','recommendation','accuracy','risk','notes'])
  if (!['recommended','excluded','neutral','unknown'].includes(String(body.recommendation)) || !['accurate','inaccurate','unknown'].includes(String(body.accuracy)) || !['low','medium','high','unknown'].includes(String(body.risk))) invalid()
  return { observationId:uuid(body.observationId),recommendation:String(body.recommendation),accuracy:String(body.accuracy),risk:String(body.risk),notes:text(body.notes,2000) }
}
export function parseVisibilityDraft(raw: unknown) {
  const body = object(raw,['observationId','kind','locale'])
  if (!['brief','schema','technical_patch'].includes(String(body.kind)) || !isPromptLanguage(body.locale)) invalid()
  return { observationId:uuid(body.observationId),kind:String(body.kind) as 'brief'|'schema'|'technical_patch',locale:body.locale }
}
