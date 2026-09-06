import type { VersionDetail } from '@/lib/change-sets/types'
import { draft, clientId } from './c9c-fixtures'
export { draft, clientId }
export const version: VersionDetail = {
  schemaVersion: 1,
  id: '55555555-5555-4555-8555-555555555555',
  workItemId: draft.id,
  versionNumber: 1,
  draftRevision: 1,
  title: 'Frozen <script>alert(1)</script> 版本',
  action: 'Frozen action',
  notes: 'Frozen notes',
  locale: 'en',
  evidenceSnapshot: draft.evidenceSnapshot,
  contentHash: 'a'.repeat(64),
  submittedBy: {
    profileId: clientId,
    displayName: 'Submitter',
    role: 'account_member',
  },
  submittedAt: '2026-09-06T00:00:00Z',
  decision: null,
  capabilities: { canDecide: true },
  validation: {
    policyVersion: 'change-set-review.v1',
    checks: [
      { code: 'text', status: 'pass' },
      { code: 'locale', status: 'pass' },
      { code: 'evidence', status: 'pass' },
      { code: 'content_size', status: 'pass' },
    ],
  },
}
export const initial = {
  versions: [version],
  nextCursor: null,
  latestVersionId: version.id,
}
export const access = {
  members: [
    {
      profileId: clientId,
      displayName: 'Member <script>test</script> 成員',
      active: false,
      revision: 0,
    },
  ],
  events: [],
  nextMemberCursor: null,
  nextEventCursor: null,
}
