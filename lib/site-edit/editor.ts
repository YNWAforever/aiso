import type { EditSpecSchemaType, EditSpecV1, JsonLdEditSpec } from './edit-spec'

/** Browser-safe editor helpers for the draft's site-edit section. */
export type SpecMode = 'jsonld' | 'meta' | 'llms_txt'
export type SpecFields = {
  on: boolean; type: EditSpecSchemaType; url: string; payload: string; remove?: boolean
  /** S9: which kind of edit. Absent means JSON-LD, as before S9. */
  mode?: SpecMode; title?: string; description?: string
  /** S10: the llms.txt file's text. */
  content?: string
}

const isJsonLd = (spec: EditSpecV1 | null | undefined): spec is JsonLdEditSpec => spec?.kind === 'jsonld' || spec?.kind === 'jsonld_remove'

export const specPayloadText = (spec: EditSpecV1 | null | undefined) => isJsonLd(spec) ? JSON.stringify(spec.payload, null, 2) : ''

export function specFields(spec: EditSpecV1 | null | undefined): SpecFields {
  const meta = spec?.kind === 'meta' ? spec : null
  const llms = spec?.kind === 'llms_txt' ? spec : null
  const jsonld = isJsonLd(spec) ? spec : null
  return {
    on: Boolean(spec), mode: meta ? 'meta' : llms ? 'llms_txt' : 'jsonld', type: jsonld?.schemaType ?? 'FAQPage', url: spec?.targetUrl ?? '',
    payload: specPayloadText(spec), remove: jsonld?.kind === 'jsonld_remove', title: meta?.title ?? '', description: meta?.description ?? '',
    content: llms?.content ?? '',
  }
}

export function specDirty(fields: SpecFields, saved: EditSpecV1 | null | undefined): boolean {
  const base = specFields(saved)
  if (fields.on !== base.on) return true
  if (!fields.on) return false
  const mode = fields.mode ?? 'jsonld'
  if (mode !== base.mode || fields.url !== base.url) return true
  if (mode === 'meta') return (fields.title ?? '') !== base.title || (fields.description ?? '') !== base.description
  if (mode === 'llms_txt') return (fields.content ?? '') !== base.content
  return fields.type !== base.type || fields.payload !== base.payload || Boolean(fields.remove) !== base.remove
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
  if (fields.mode === 'meta') {
    return { schemaVersion: 1, kind: 'meta', targetUrl: fields.url, title: fields.title?.trim() || null, description: fields.description?.trim() || null }
  }
  if (fields.mode === 'llms_txt') return { schemaVersion: 1, kind: 'llms_txt', targetUrl: fields.url, content: fields.content ?? '' }
  return { schemaVersion: 1, kind: fields.remove ? 'jsonld_remove' : 'jsonld', targetUrl: fields.url, schemaType: fields.type, payload: JSON.parse(fields.payload) }
}
