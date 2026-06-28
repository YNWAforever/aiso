import type { LocalTrustRoiEstimate } from '@/lib/types'
import type { EstimateRoiInput } from './types'

export function estimateRoi({
  previousScore,
  currentSnapshot,
  averageLeadValue,
  closeRate,
}: EstimateRoiInput): LocalTrustRoiEstimate | null {
  if (!averageLeadValue || !closeRate || averageLeadValue <= 0 || closeRate <= 0) return null

  const baseline = previousScore ?? Math.max(0, currentSnapshot.local_trust_score - 5)
  const scoreDelta = Math.max(0, currentSnapshot.local_trust_score - baseline)
  if (scoreDelta <= 0) return null

  const estimatedExtraEnquiriesLow = Math.max(1, Math.round(scoreDelta / 10))
  const estimatedExtraEnquiriesHigh = Math.max(estimatedExtraEnquiriesLow + 1, Math.round(scoreDelta / 4))

  return {
    low: Math.round(estimatedExtraEnquiriesLow * averageLeadValue * closeRate),
    high: Math.round(estimatedExtraEnquiriesHigh * averageLeadValue * closeRate),
    currency: 'HKD',
    confidence: 'directional',
    assumptions: {
      averageLeadValue,
      closeRate,
      estimatedExtraEnquiriesLow,
      estimatedExtraEnquiriesHigh,
    },
  }
}
