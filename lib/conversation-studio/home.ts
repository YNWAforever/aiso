import type { StudioEvidence, StudioTemplate } from './types'

export const STUDIO_FILTERS = ['all', 'discover', 'improve', 'monitor', 'report'] as const
export type StudioFilter = typeof STUDIO_FILTERS[number]
export const STUDIO_HOME_TEMPLATES = ['opportunity', 'improve', 'brief', 'competitors', 'pulse', 'report'] as const
export type StudioHomeTemplate = typeof STUDIO_HOME_TEMPLATES[number]
export type StudioSourceStatus = 'bound' | 'unbound' | 'reconnect' | 'rebind' | 'unavailable'

// Task presentation maps to B1's existing capabilities; no new analysis runs.
export const HOME_TASKS: Record<StudioHomeTemplate, { category: Exclude<StudioFilter, 'all'>; capability: StudioTemplate; destination?: 'opportunities' | 'reports' }> = {
  opportunity: { category: 'discover', capability: 'brief', destination: 'opportunities' },
  improve: { category: 'improve', capability: 'brief' },
  brief: { category: 'improve', capability: 'brief' },
  competitors: { category: 'discover', capability: 'competitors' },
  pulse: { category: 'monitor', capability: 'pulse' },
  report: { category: 'report', capability: 'report', destination: 'reports' },
}

export function evidenceForHomeTask(evidence: StudioEvidence, task: StudioHomeTemplate | null): StudioEvidence {
  // The page-improvement task can only summarise the already-loaded owned scan.
  return task === 'improve' ? { ...evidence, observations: [] } : evidence
}
