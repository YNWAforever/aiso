/** Browser-safe normalization shared by the editor and server input contract. */
export type DraftEditInput = {
  title: string
  action: string
  notes: string
  expectedRevision: number
}
export const EDIT_DRAFT_BODY_LIMIT = 32 * 1024
export function parseDraftEdit(value: unknown): DraftEditInput {
  const invalid = (): never => {
    throw new Error('INVALID_WORK_ITEM_INPUT')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  let encoded: string | undefined
  try {
    encoded = JSON.stringify(value)
  } catch {
    invalid()
  }
  if (
    encoded === undefined ||
    new TextEncoder().encode(encoded).byteLength > EDIT_DRAFT_BODY_LIMIT
  )
    invalid()
  const input = value as Record<string, unknown>
  const keys = ['title', 'action', 'notes', 'expectedRevision']
  if (
    Object.keys(input).length !== keys.length ||
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
  return {
    title: text(input.title, 1, 160),
    action: text(input.action, 1, 4000),
    notes: text(input.notes, 0, 8000),
    expectedRevision: input.expectedRevision as number,
  }
}
