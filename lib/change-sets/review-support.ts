export type ReviewMemberSupport = 'unknown' | 'none' | 'other'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const identity = (value: unknown): string | null => typeof value === 'string' && uuid.test(value) ? value.toLowerCase() : null

/** Account-role information only. This never establishes permission to review a version. */
export function reviewMemberSupport(value: unknown, expectedViewer: string, submittedBy: string): ReviewMemberSupport {
  const viewer = identity(expectedViewer), submitter = identity(submittedBy)
  if (!viewer || !submitter || !record(value) || identity(value.self) !== viewer || !Array.isArray(value.members)) return 'unknown'
  const seen = new Set<string>()
  let activeViewer = false, other = false
  for (const member of value.members) {
    if (!record(member)) return 'unknown'
    const profileId = identity(member.profileId)
    if (!profileId || seen.has(profileId) || typeof member.active !== 'boolean' || typeof member.approver !== 'boolean') return 'unknown'
    seen.add(profileId)
    if (profileId === viewer) activeViewer = member.active
    if (profileId !== viewer && profileId !== submitter && member.active && member.approver) other = true
  }
  if (!activeViewer) return 'unknown'
  return other ? 'other' : 'none'
}
