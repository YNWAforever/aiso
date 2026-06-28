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

export type LocalTrustInput = {
  accountId: string
  client: Client
  profile: LocalTrustProfile | null
  scan: Scan | null
  pulseSummary: PulseWeeklySummary[]
  missed: PulseMetric[]
  competitors: AgentCompetitor[]
}

export type EstimateRoiInput = {
  previousScore?: number
  currentSnapshot: LocalTrustSnapshotDraft
  averageLeadValue?: number | null
  closeRate?: number | null
}
