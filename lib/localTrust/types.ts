import type {
  AgentCompetitor,
  Client,
  LocalTrustBucketScore,
  LocalTrustGap,
  LocalTrustProfile,
  LocalTrustRoiEstimate,
  PulseMetric,
  PulseWeeklySummary,
  Scan,
} from '@/lib/types'

export type LocalTrustSnapshotDraft = {
  client_id: string
  account_id: string
  snapshot_month: string
  local_trust_score: number
  bucket_scores: LocalTrustBucketScore[]
  trust_gaps: LocalTrustGap[]
  roi_estimate: LocalTrustRoiEstimate | null
  source_scan_id: string | null
  source_pulse_week: string | null
}

/**
 * The month this client's score is being compared against, read from the most
 * recent earlier row in `local_trust_snapshots`.
 *
 * Score and month travel together on purpose: a baseline that cannot say which
 * month it came from cannot be shown to the owner, and an enquiry-value figure
 * whose origin cannot be stated is the defect this type exists to prevent.
 */
export type LocalTrustBaseline = {
  score: number
  month: string
}

export type LocalTrustInput = {
  accountId: string
  client: Client
  profile: LocalTrustProfile | null
  scan: Scan | null
  pulseSummary: PulseWeeklySummary[]
  missed: PulseMetric[]
  competitors: AgentCompetitor[]
  /** Required, nullable. See the note on `roiScenario` for why it is not optional. */
  previous: LocalTrustBaseline | null
}

export type EstimateRoiInput = {
  /** Required, nullable. Null means there is no earlier month, not "assume one". */
  previous: LocalTrustBaseline | null
  currentSnapshot: LocalTrustSnapshotDraft
  averageLeadValue?: number | null
  closeRate?: number | null
}
