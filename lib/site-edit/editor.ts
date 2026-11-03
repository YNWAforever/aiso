import type { EditSpecSchemaType, EditSpecV1 } from './edit-spec'

/** Browser-safe editor helpers for the draft's site-edit section. */
export type SpecFields = { on: boolean; type: EditSpecSchemaType; url: string; payload: string }

export const specPayloadText = (spec: EditSpecV1 | null | undefined) => spec ? JSON.stringify(spec.payload, null, 2) : ''

export function specFields(spec: EditSpecV1 | null | undefined): SpecFields {
  return { on: Boolean(spec), type: spec?.schemaType ?? 'FAQPage', url: spec?.targetUrl ?? '', payload: specPayloadText(spec) }
}

export function specDirty(fields: SpecFields, saved: EditSpecV1 | null | undefined): boolean {
  const base = specFields(saved)
  if (fields.on !== base.on) return true
  return fields.on && (fields.type !== base.type || fields.url !== base.url || fields.payload !== base.payload)
}

/**
 * What the PATCH should carry: undefined = leave the stored spec unchanged,
 * null = clear it, object = the spec to validate and store. An untouched spec
 * is not re-sent, so a text-only save never re-runs the domain check (a lapsed
 * verification must not block editing the notes). Throws on invalid JSON.
 */
export function specRequest(fields: SpecFields, saved: EditSpecV1 | null | undefined): unknown {
  if (!fields.on) return saved ? null : undefined
  if (!specDirty(fields, saved)) return undefined
  return { schemaVersion: 1, kind: 'jsonld', targetUrl: fields.url, schemaType: fields.type, payload: JSON.parse(fields.payload) }
}
