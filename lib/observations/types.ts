export interface Question {
  id: string
  question: string
  category: string | null
  language: string | null
  isActive: boolean | null
}

export interface Observation {
  id: string
  sourceKind: 'pulse-metric'
  promptId: string | null
  question: string
  platform: string
  scanWeek: string
  recordedAt: string | null
  collectedAt: string|null
  model: string|null
  market: string|null
  result: 'success' | 'incomplete'
  hasAnswer: boolean
  brandMentioned: boolean | null
  currentPrompt: Question | null
  limitations: string[]
}

export interface ObservationResponse {
  schemaVersion: 1
  clientId: string
  selectedWeek: string | null
  weeks: string[]
  questionsTruncated: boolean
  questions: Question[]
  items: Observation[]
  counts: {
    recordedRows: number
    successfulRows: number
    incompleteRows: number
  }
  nextCursor: string | null
}

export interface PulseSourceRow {
  id: string
  prompt_id: string | null
  question: string
  platform: string
  scan_week: string
  created_at: string | null
  raw_answer: string | null
  brand_mentioned: boolean | null
  has_answer?: boolean
  classification_status?: string|null
  actual_model?: string|null
  collected_at?: string|null
  market?: string|null
}

export interface ObservationDetailDto extends Observation {
  rawAnswer:string|null
  promptSnapshot:{question:string;category:string|null;language:string|null;market:string|null}|null
  brandSnapshot:{name:string;competitors:string[]}|null
  requestedModel:string|null
  collector:string|null
  collectorVersion:string|null
  providerRequestId:string|null
  classification:{status:'classified'|'fallback'|'failed'|'legacy_unknown';method:string|null;version:string|null;
    brandMentioned:boolean|null;sentiment:'positive'|'neutral'|'negative'|'unknown';matchedText:string[]}
  links:{url:string;kind:'text-link'|'provider-citation'}[]
}
export type ObservationDetailRow=PulseSourceRow & {
  snapshot:ObservationDetailDto['promptSnapshot'];brand_snapshot:ObservationDetailDto['brandSnapshot'];
  requested_model:string|null;collector:string|null;collector_version:string|null;provider_request_id:string|null;
  classifier_method:string|null;classifier_version:string|null;sentiment:string|null;matched_text:unknown;
}
