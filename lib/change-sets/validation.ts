import 'server-only'

import { fingerprintEvidence, serializeDraftSnapshot } from '@/lib/opportunities/fingerprint'
import { parseDraftEdit } from '@/lib/work-items/edit-input'
import type { WorkItem } from '@/lib/work-items/schema'
import type { FrozenReview, ReviewContent, ValidationResult } from './types'

const REVIEW_CONTENT_LIMIT = 128 * 1024

function validationFailed(): never {
  throw new Error('REVIEW_VALIDATION_FAILED')
}

function conservativeJsonBytes(value: unknown): number {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value, null, 2)
  } catch {
    validationFailed()
  }
  if (serialized === undefined) validationFailed()
  return new TextEncoder().encode(serialized).byteLength
}

export function assertReviewPackageSize(value: unknown): void {
  if (conservativeJsonBytes(value) > REVIEW_CONTENT_LIMIT) validationFailed()
}

export function freezeReview(item: WorkItem): FrozenReview {
  try {
    if (item.locale !== 'en' && item.locale !== 'zh-HK') validationFailed()

    const edit = parseDraftEdit({
      title: item.title,
      action: item.action,
      notes: item.notes,
      expectedRevision: item.revision,
    })
    if (edit.title !== item.title || edit.action !== item.action || edit.notes !== item.notes) validationFailed()

    const evidenceSnapshot = JSON.parse(serializeDraftSnapshot(item.evidenceSnapshot)) as WorkItem['evidenceSnapshot']
    const content: ReviewContent = {
      schemaVersion: 1,
      workItemId: item.id,
      draftRevision: item.revision,
      title: item.title,
      action: item.action,
      notes: item.notes,
      locale: item.locale,
      evidenceSnapshot,
    }
    assertReviewPackageSize(content)

    const validation: ValidationResult = {
      policyVersion: 'change-set-review.v1',
      checks: [
        { code: 'text', status: 'pass' },
        { code: 'locale', status: 'pass' },
        { code: 'evidence', status: 'pass' },
        { code: 'content_size', status: 'pass' },
      ],
    }
    return { content, contentHash: fingerprintEvidence(content), validation }
  } catch {
    validationFailed()
  }
}
