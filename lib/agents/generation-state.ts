export type GenerationSectionState = 'available' | 'unavailable' | 'not-required'
export type GenerationOutcomes = Record<'recommendations' | 'progress' | 'competitors', GenerationSectionState>
export type AgentGenerationReceipt = {
  version: 1
  producer: 'native-improve.v1'
  token: string
  state: 'running' | 'complete' | 'error'
  fingerprint: string
  startedAt: string
  leaseUntil: string
  completedAt?: string
  providerStarted: boolean
  outcomes: GenerationOutcomes
  counts: Record<keyof GenerationOutcomes, number>
  reasons: Partial<Record<keyof GenerationOutcomes, string>>
  sourceCheckIds: string[]
  recommendationBasis?: {
    checkId: string; assessment: string; action: string
    source: { scanId: string; checkId: string }; limitations: string[]
  }[]
  progressSamples?: { platform: string; week: string; classified: number; mentioned: number }[]
  provider?: {
    requestedModel: string; actualModel: string | null; requestId: string | null
    promptTokens: number | null; completionTokens: number | null; costUsd: number | null; httpStatus: number | null
  }
  error?: string
}
export type ImproveResult = {
  status: number
  state: 'complete' | 'running' | 'unavailable' | 'error'
  scanId: string
  generation: AgentGenerationReceipt | null
  error?: string
}

/** Client-safe receipt projection. Unknown producers are never treated as native completion. */
export function readAgentGeneration(value: unknown): AgentGenerationReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const r = value as Partial<AgentGenerationReceipt>
  if (r.version !== 1 || r.producer !== 'native-improve.v1' || typeof r.token !== 'string'
    || !['running', 'complete', 'error'].includes(String(r.state))) return null
  const states = ['available', 'unavailable', 'not-required']
  return {
    ...r, version: 1, producer: 'native-improve.v1', token: r.token, state: r.state!,
    fingerprint: typeof r.fingerprint === 'string' ? r.fingerprint : '',
    startedAt: typeof r.startedAt === 'string' ? r.startedAt : '',
    leaseUntil: typeof r.leaseUntil === 'string' ? r.leaseUntil : '',
    providerStarted: r.providerStarted === true,
    outcomes: Object.fromEntries(['recommendations', 'progress', 'competitors'].map(key => [key,
      states.includes(String(r.outcomes?.[key as keyof GenerationOutcomes])) ? r.outcomes![key as keyof GenerationOutcomes] : 'unavailable'])) as GenerationOutcomes,
    counts: r.counts ?? { recommendations: 0, progress: 0, competitors: 0 },
    reasons: r.reasons ?? {}, sourceCheckIds: Array.isArray(r.sourceCheckIds) ? r.sourceCheckIds.filter(id => typeof id === 'string') : [],
  }
}
