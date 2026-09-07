import { AsyncLocalStorage } from 'node:async_hooks'
import type { EvidenceObservation } from '@/lib/scan-evidence'

// A separate module keeps capture independent of injected/mocked transports.
// Each invocation inherits only its own observer, including concurrent checks.
export const evidenceFetchContext = new AsyncLocalStorage<(observation: EvidenceObservation) => void>()
export function emitFetchEvidence(observation: EvidenceObservation) {
  try { evidenceFetchContext.getStore()?.(observation) } catch { /* diagnostics cannot change fetch semantics */ }
}
