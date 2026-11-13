import { freezeReview } from '@/lib/change-sets/validation'
import { approvedVersion } from './fixtures'

/** Inputs captured against the untouched c6e37e6b V1 renderer before PR3 edits. */
export function goldenVersions() {
  const unicode = approvedVersion()
  const precise = approvedVersion()
  precise.decision!.reason = 'Reviewed\tcontent\r\nand evidence 保留 é 😀'
  precise.submittedAt = '2026-09-06T08:00:00.123456+08:00'
  precise.decision!.decidedAt = '2026-09-06T09:00:00.654321+08:00'
  const spec = approvedVersion()
  spec.editSpec = { schemaVersion: 1, kind: 'llms_txt', targetUrl: 'https://example.com/llms.txt', content: '# 保留 é 😀\n\nApproved evidence\n' }
  const frozen = freezeReview({ ...spec, id: spec.workItemId, revision: spec.draftRevision } as Parameters<typeof freezeReview>[0])
  Object.assign(spec, frozen.content, { contentHash: frozen.contentHash, validation: frozen.validation })
  return { unicode, precise, spec }
}
