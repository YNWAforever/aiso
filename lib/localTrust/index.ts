export type { EstimateRoiInput, LocalTrustBaseline, LocalTrustInput, LocalTrustSnapshotDraft } from './types'
export { calculateLocalTrust, localTrustRoiScenario, resolveSnapshotMonth } from './scoring'
export { estimateRoi, roiScenario, type RoiScenario, type RoiUnavailable } from './roi'
export { domainsMatch, findNewestMatchingScan, normalizeDomain } from './scan'
