import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { freezeMultiSourceReview, freezeReview } from '@/lib/change-sets/validation'
import { versionDTO } from '@/lib/change-sets/store'
import { createDeliveryExport } from '@/lib/delivery/export'
import { parseDraftEdit } from '@/lib/work-items/edit-input'
import { fingerprintEvidence } from '@/lib/opportunities/fingerprint'
import { parseEditSpec, type JsonLdEditSpec } from '@/lib/site-edit/edit-spec'
const parseJsonLd = (value: unknown) => parseEditSpec(value) as JsonLdEditSpec
import { draft, saved } from '../change-sets/fixtures'
import { approvedVersion } from '../delivery/fixtures'

const spec = parseJsonLd({
  schemaVersion: 1,
  kind: 'jsonld',
  targetUrl: 'https://www.example.com/faq',
  schemaType: 'FAQPage',
  payload: { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'Sourdough?', acceptedAnswer: { '@type': 'Answer', text: 'Daily.' } }] },
})

describe('draft edit input', () => {
  const base = { title: 'Review', action: 'Check', notes: '', expectedRevision: 1 }

  it('leaves the spec unchanged when absent, clears it with null, and parses it when given', () => {
    expect(parseDraftEdit(base)).not.toHaveProperty('editSpec')
    expect(parseDraftEdit({ ...base, editSpec: null })).toEqual({ ...base, editSpec: null })
    expect(parseDraftEdit({ ...base, editSpec: spec }).editSpec).toEqual(spec)
  })

  it('refuses an invalid spec as invalid input', () => {
    expect(() => parseDraftEdit({ ...base, editSpec: { ...spec, targetUrl: 'http://www.example.com/' } })).toThrow('INVALID_WORK_ITEM_INPUT')
    expect(() => parseDraftEdit({ ...base, editSpec: 'yes' })).toThrow('INVALID_WORK_ITEM_INPUT')
  })

  it('keeps the text budget independent of the spec', () => {
    const maxText = { ...base, action: '😀'.repeat(4000), notes: '😀'.repeat(8000) }
    expect(() => parseDraftEdit(maxText)).toThrow('INVALID_WORK_ITEM_INPUT')
    expect(() => parseDraftEdit({ ...maxText, editSpec: spec })).toThrow('INVALID_WORK_ITEM_INPUT')
    expect(parseDraftEdit({ ...base, notes: 'x'.repeat(8000), editSpec: spec }).editSpec).toEqual(spec)
  })
})

describe('freezing a spec into the review version', () => {
  it('leaves a spec-less version byte-identical (no editSpec key, same hash)', () => {
    const plain = freezeReview(draft())
    const withNull = freezeReview({ ...draft(), editSpec: null })
    expect(plain.content).not.toHaveProperty('editSpec')
    expect(withNull.contentHash).toBe(plain.contentHash)
    expect(JSON.stringify(withNull.content)).toBe(JSON.stringify(plain.content))
  })

  it('freezes the exact spec into content, so approval covers it and the hash moves', () => {
    const plain = freezeReview(draft())
    const frozen = freezeReview({ ...draft(), editSpec: spec })
    expect(frozen.content.editSpec).toEqual(spec)
    expect(frozen.contentHash).not.toBe(plain.contentHash)
    expect(frozen.contentHash).toBe(fingerprintEvidence(frozen.content))
    const other = freezeReview({ ...draft(), editSpec: { ...spec, targetUrl: 'https://www.example.com/about' } })
    expect(other.contentHash).not.toBe(frozen.contentHash)
  })

  it('freezes the spec on the multi-source path too', () => {
    const item = draft()
    const frozen = freezeMultiSourceReview({ ...item, editSpec: spec }, [item.evidenceSnapshot])
    expect(frozen.content.editSpec).toEqual(spec)
  })

  it('freezes a key-reordered spec (jsonb reorders keys) to the same content and hash', () => {
    const frozen = freezeReview({ ...draft(), editSpec: spec })
    const reordered = { payload: { mainEntity: spec.payload.mainEntity, '@type': 'FAQPage', '@context': 'https://schema.org' }, targetUrl: spec.targetUrl, kind: 'jsonld', schemaVersion: 1, schemaType: 'FAQPage' } as never
    const again = freezeReview({ ...draft(), editSpec: reordered })
    expect(again.contentHash).toBe(frozen.contentHash)
    expect(JSON.stringify(again.content)).toBe(JSON.stringify(frozen.content))
  })

  it('refuses a stored spec whose values are not canonical or not valid', () => {
    const decomposed = { ...spec, payload: { ...spec.payload, name: 'Cafe\u0301' } }
    expect(() => freezeReview({ ...draft(), editSpec: decomposed as never })).toThrow('REVIEW_VALIDATION_FAILED')
    expect(() => freezeReview({ ...draft(), editSpec: { ...spec, targetUrl: 'https://WWW.example.com/faq' } })).toThrow('REVIEW_VALIDATION_FAILED')
    expect(() => freezeReview({ ...draft(), editSpec: { ...spec, schemaType: 'Organization' } as never })).toThrow('REVIEW_VALIDATION_FAILED')
  })

  it('round-trips through versionDTO and rejects a row whose spec was tampered with', async () => {
    const row = await saved()
    const frozen = freezeReview({ ...draft(), editSpec: spec })
    const withSpec = { ...row, content: frozen.content, content_hash: frozen.contentHash }
    expect(versionDTO(withSpec).editSpec).toEqual(spec)
    const tampered = { ...withSpec, content: { ...frozen.content, editSpec: { ...spec, targetUrl: 'https://www.example.com/other' } } }
    expect(() => versionDTO(tampered)).toThrow('CHANGE_SET_UNAVAILABLE')
    // A spec-less historical row still reads exactly as before.
    expect(versionDTO(row)).not.toHaveProperty('editSpec')
  })
})

describe('approved export', () => {
  it('carries the exact JSON-LD spec in the canonical envelope and the text body', () => {
    const base = approvedVersion()
    const frozen = freezeReview({ id: base.workItemId, revision: base.draftRevision, title: base.title, action: base.action, notes: base.notes, locale: base.locale, evidenceSnapshot: base.evidenceSnapshot, editSpec: spec } as never)
    const version = { ...base, ...frozen.content, contentHash: frozen.contentHash }
    const json = JSON.parse(createDeliveryExport(version, 'json').body)
    expect(json.content.editSpec).toEqual(spec)
    expect(json.contentHash).toBe(frozen.contentHash)
    const text = createDeliveryExport(version, 'text').body
    expect(text).toContain('"schemaType": "FAQPage"')
    expect(text).toContain('https://www.example.com/faq')
  })

  it('still exports a spec-less version unchanged', () => {
    const json = JSON.parse(createDeliveryExport(approvedVersion(), 'json').body)
    expect(json.content).not.toHaveProperty('editSpec')
  })
})
