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
  collectedAt: null
  model: null
  market: null
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
}
