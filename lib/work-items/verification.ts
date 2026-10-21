export interface WorkVerificationBaseline {
  source: string
  observedAt: string | null
  target: string | null
  issuePresent: true
}

export interface WorkVerificationObservation {
  id: string
  source: string
  observedAt: string | null
  target: string | null
  methodCompatible: boolean
  issuePresent: boolean | null
}

export type WorkVerificationResult = {
  state: 'observed_improvement' | 'no_observed_improvement' | 'insufficient_evidence'
  baseline: WorkVerificationBaseline
  reportedAt: string
  observations: WorkVerificationObservation[]
  selectedObservationId: string | null
  reasons: Array<'no_observation' | 'observation_before_report' | 'timing_unknown'
    | 'method_incompatible' | 'result_unknown'>
  attribution: 'not_established'
}

function validTime(value: string | null): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export function evaluateWorkVerification(input: {
  baseline: WorkVerificationBaseline
  reportedAt: string
  observations: WorkVerificationObservation[]
}): WorkVerificationResult {
  const reasons = new Set<WorkVerificationResult['reasons'][number]>()
  const eligible: WorkVerificationObservation[] = []
  const reportedAt = Date.parse(input.reportedAt)

  for (const observation of input.observations) {
    if (!validTime(observation.observedAt)) reasons.add('timing_unknown')
    else if (!Number.isFinite(reportedAt) || Date.parse(observation.observedAt) <= reportedAt) {
      reasons.add('observation_before_report')
    } else if (!observation.methodCompatible) reasons.add('method_incompatible')
    else if (observation.issuePresent === null) reasons.add('result_unknown')
    else eligible.push(observation)
  }

  eligible.sort((left, right) =>
    Date.parse(left.observedAt!) - Date.parse(right.observedAt!)
      || left.id.localeCompare(right.id))
  const selected = eligible[0] ?? null
  if (!selected) {
    if (!input.observations.length) reasons.add('no_observation')
    return {
      state: 'insufficient_evidence',
      baseline: input.baseline,
      reportedAt: input.reportedAt,
      observations: input.observations,
      selectedObservationId: null,
      reasons: [...reasons],
      attribution: 'not_established',
    }
  }
  return {
    state: selected.issuePresent ? 'no_observed_improvement' : 'observed_improvement',
    baseline: input.baseline,
    reportedAt: input.reportedAt,
    observations: input.observations,
    selectedObservationId: selected.id,
    reasons: [...reasons],
    attribution: 'not_established',
  }
}
