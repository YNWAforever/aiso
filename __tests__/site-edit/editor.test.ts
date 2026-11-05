import { describe, expect, it } from 'vitest'
import { parseEditSpec, type JsonLdEditSpec } from '@/lib/site-edit/edit-spec'
const parseJsonLd = (value: unknown) => parseEditSpec(value) as JsonLdEditSpec
import { specDirty, specFields, specRequest } from '@/lib/site-edit/editor'

const spec = parseJsonLd({
  schemaVersion: 1, kind: 'jsonld', targetUrl: 'https://www.example.com/', schemaType: 'Organization',
  payload: { '@context': 'https://schema.org', '@type': 'Organization', name: 'Example Bakery' },
})

describe('site-edit editor request', () => {
  it('does not re-send an untouched saved spec (a text-only save skips the domain check)', () => {
    const fields = specFields(spec)
    expect(specDirty(fields, spec)).toBe(false)
    expect(specRequest(fields, spec)).toBeUndefined()
  })

  it('sends the spec when any field changed', () => {
    const changed = { ...specFields(spec), url: 'https://www.example.com/about' }
    expect(specDirty(changed, spec)).toBe(true)
    expect(specRequest(changed, spec)).toMatchObject({ targetUrl: 'https://www.example.com/about', schemaType: 'Organization' })
  })

  it('clears with null when unticked over a saved spec, and sends nothing when there was none', () => {
    expect(specRequest({ ...specFields(spec), on: false }, spec)).toBeNull()
    expect(specRequest(specFields(null), null)).toBeUndefined()
  })

  it('sends a newly ticked spec and throws on invalid JSON', () => {
    const fresh = { on: true, type: 'Organization' as const, url: 'https://www.example.com/', payload: '{"@context":"https://schema.org","@type":"Organization"}' }
    expect(specRequest(fresh, null)).toMatchObject({ kind: 'jsonld', payload: { '@type': 'Organization' } })
    expect(() => specRequest({ ...fresh, payload: '{' }, null)).toThrow()
  })

  it('S5: carries the revert flag both ways and treats flipping it as a change', () => {
    const revert = parseJsonLd({ ...spec, kind: 'jsonld_remove' })
    expect(specFields(revert).remove).toBe(true)
    expect(specDirty({ ...specFields(spec), remove: true }, spec)).toBe(true)
    expect(specRequest({ ...specFields(spec), remove: true }, spec)).toMatchObject({ kind: 'jsonld_remove', payload: spec.payload })
    expect(specRequest(specFields(revert), revert)).toBeUndefined()
  })

  it('S9: round-trips a meta spec, sends empty fields as null, and treats switching kinds as a change', () => {
    const meta = parseEditSpec({ schemaVersion: 1, kind: 'meta', targetUrl: 'https://www.example.com/', title: 'Menu', description: null })
    expect(specFields(meta)).toMatchObject({ on: true, mode: 'meta', title: 'Menu', description: '', url: 'https://www.example.com/', payload: '' })
    expect(specRequest(specFields(meta), meta)).toBeUndefined()
    expect(specDirty({ ...specFields(meta), description: 'Fresh bread.' }, meta)).toBe(true)
    expect(specRequest({ ...specFields(meta), title: '  ', description: ' Fresh bread. ' }, meta))
      .toEqual({ schemaVersion: 1, kind: 'meta', targetUrl: 'https://www.example.com/', title: null, description: 'Fresh bread.' })
    expect(specDirty({ ...specFields(spec), mode: 'meta' }, spec)).toBe(true)
    expect(specRequest({ ...specFields(spec), mode: 'meta', title: 'New' }, spec)).toMatchObject({ kind: 'meta', title: 'New', description: null })
    // A JSON-LD caller that never sets `mode` behaves exactly as before S9.
    const { mode: _m, title: _t, description: _d, ...legacy } = specFields(spec)
    expect(specDirty(legacy, spec)).toBe(false)
  })
})
