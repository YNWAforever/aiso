import 'server-only'

import { fingerprintEvidence, serializeDraftSnapshot } from '@/lib/opportunities/fingerprint'
import { parseDraftEdit } from '@/lib/work-items/edit-input'
import type { WorkItem } from '@/lib/work-items/schema'
import type { FrozenReviewV1, FrozenReviewV2, ReviewContentV1, ReviewContentV2, ValidationResult } from './types'

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

export function freezeReview(item: WorkItem): FrozenReviewV1 {
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
    const content: ReviewContentV1 = {
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

/**
 * The multi-source freeze path (WORK_ITEM_MULTI_SOURCE_V1). One entry per
 * LIVE source, not the item's own now-legacy evidenceSnapshot column --
 * `item` here deliberately does not carry one.
 *
 * Refuses an empty array: a work item with zero live sources is a piece of
 * work with no evidence behind it, which lib/work-items/sources.ts's
 * withdrawSource already refuses to create by refusing to withdraw the last
 * source -- this is the same invariant, enforced again at freeze time rather
 * than trusted from the caller.
 */
export function freezeMultiSourceReview(
  item: Pick<WorkItem, 'id' | 'revision' | 'title' | 'action' | 'notes' | 'locale'>,
  snapshots: WorkItem['evidenceSnapshot'][],
): FrozenReviewV2 {
  try {
    if (item.locale !== 'en' && item.locale !== 'zh-HK') validationFailed()
    if (snapshots.length < 1) validationFailed()

    const edit = parseDraftEdit({
      title: item.title,
      action: item.action,
      notes: item.notes,
      expectedRevision: item.revision,
    })
    if (edit.title !== item.title || edit.action !== item.action || edit.notes !== item.notes) validationFailed()

    const evidenceSnapshots = snapshots.map(
      snapshot => JSON.parse(serializeDraftSnapshot(snapshot)) as WorkItem['evidenceSnapshot'],
    )
    const content: ReviewContentV2 = {
      schemaVersion: 2,
      workItemId: item.id,
      draftRevision: item.revision,
      title: item.title,
      action: item.action,
      notes: item.notes,
      locale: item.locale,
      evidenceSnapshots,
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
