import { parseEditSpec, type EditSpecV1 } from '@/lib/site-edit/edit-spec'

/** Browser-safe normalization shared by the editor and server input contract. */
export type DraftEditInput = {
  title: string
  action: string
  notes: string
  expectedRevision: number
  /** Site-edit S1. Absent (undefined) leaves the stored spec unchanged; null clears it. */
  editSpec?: EditSpecV1 | null
}
/**
 * Transport cap for the whole PATCH body. The text fields keep their own
 * unchanged 32 KiB budget (EDIT_DRAFT_TEXT_LIMIT); an edit spec is bounded by
 * lib/site-edit/edit-spec.ts on top of that.
 */
export const EDIT_DRAFT_BODY_LIMIT = 64 * 1024
export const EDIT_DRAFT_TEXT_LIMIT = 32 * 1024
export function parseDraftEdit(value: unknown): DraftEditInput {
  const invalid = (): never => {
    throw new Error('INVALID_WORK_ITEM_INPUT')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const input = value as Record<string, unknown>
  let encoded: string | undefined
  try {
    // The text budget is measured without the spec, so adding a spec never
    // loosens or tightens what text a draft may hold.
    const { editSpec: _spec, ...text } = input
    void _spec
    encoded = JSON.stringify(text)
  } catch {
    invalid()
  }
  if (
    encoded === undefined ||
    new TextEncoder().encode(encoded).byteLength > EDIT_DRAFT_TEXT_LIMIT
  )
    invalid()
  const keys = ['title', 'action', 'notes', 'expectedRevision']
  const hasSpec = Object.hasOwn(input, 'editSpec')
  if (
    Object.keys(input).length !== keys.length + (hasSpec ? 1 : 0) ||
    !keys.every((key) => Object.hasOwn(input, key))
  )
    invalid()
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    (input.expectedRevision as number) <= 0
  )
    invalid()
  function text(raw: unknown, min: number, max: number): string {
    if (typeof raw !== 'string') return invalid()
    const normalized = raw.trim().normalize('NFC'),
      length = Array.from(normalized).length
    if (
      length < min ||
      length > max ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(
        normalized,
      )
    )
      return invalid()
    return normalized
  }
  let editSpec: EditSpecV1 | null | undefined
  if (hasSpec) {
    try {
      editSpec = input.editSpec === null ? null : parseEditSpec(input.editSpec)
    } catch {
      invalid()
    }
  }
  return {
    title: text(input.title, 1, 160),
    action: text(input.action, 1, 4000),
    notes: text(input.notes, 0, 8000),
    expectedRevision: input.expectedRevision as number,
    ...(hasSpec ? { editSpec } : {}),
  }
}
