import { describe, expect, it } from 'vitest'
import { diffSchemas } from '@/lib/schema/diff'
import type { SchemaSnapshot } from '@/lib/schema/types'

function snapshot(overrides: Partial<SchemaSnapshot> = {}): SchemaSnapshot {
  return {
    columns: {}, constraints: {}, indexes: {}, triggers: {},
    functions: {}, grants: {}, rls: {}, extensions: {},
    ...overrides,
  }
}

describe('diffSchemas', () => {
  it('reports equivalence for identical snapshots', () => {
    const legacy = snapshot({ columns: { 'clients.id': 'uuid|NO|gen_random_uuid()' } })
    const baseline = snapshot({ columns: { 'clients.id': 'uuid|NO|gen_random_uuid()' } })
    const result = diffSchemas(legacy, baseline)

    expect(result.equivalent).toBe(true)
    expect(result.classes.columns.onlyInLegacy).toEqual([])
    expect(result.classes.columns.onlyInBaseline).toEqual([])
    expect(result.classes.columns.changed).toEqual([])
  })

  it('reports a table the baseline forgot to create', () => {
    const legacy = snapshot({ columns: { 'scans.id': 'uuid|NO|', 'fix_packs.id': 'uuid|NO|' } })
    const baseline = snapshot({ columns: { 'scans.id': 'uuid|NO|' } })
    const result = diffSchemas(legacy, baseline)

    expect(result.equivalent).toBe(false)
    expect(result.classes.columns.onlyInLegacy).toEqual(['fix_packs.id'])
    expect(result.classes.columns.onlyInBaseline).toEqual([])
  })

  it('reports an object the baseline invented', () => {
    const result = diffSchemas(
      snapshot(),
      snapshot({ indexes: { 'scans.idx_extra': 'CREATE INDEX idx_extra ON scans (url)' } }),
    )

    expect(result.equivalent).toBe(false)
    expect(result.classes.indexes.onlyInBaseline).toEqual(['scans.idx_extra'])
  })

  it('reports a column whose type drifted', () => {
    const result = diffSchemas(
      snapshot({ columns: { 'scans.score': 'integer|YES|' } }),
      snapshot({ columns: { 'scans.score': 'numeric|YES|' } }),
    )

    expect(result.equivalent).toBe(false)
    expect(result.classes.columns.changed).toEqual([
      { key: 'scans.score', legacy: 'integer|YES|', baseline: 'numeric|YES|' },
    ])
  })

  it('catches a check constraint whose body differs though its name matches', () => {
    const result = diffSchemas(
      snapshot({ constraints: { 'accounts.reason_len': 'CHECK ((char_length(reason) <= 500))' } }),
      snapshot({ constraints: { 'accounts.reason_len': 'CHECK ((char_length(reason) <= 200))' } }),
    )

    expect(result.equivalent).toBe(false)
    expect(result.classes.constraints.changed).toHaveLength(1)
  })

  it('catches a trigger the baseline dropped even when its function survives', () => {
    const legacy = snapshot({
      triggers: { 'clients.enforce_brand_limit': 'check_brand_limit|7' },
      functions: { 'check_brand_limit()': 'trigger|v|true' },
    })
    const baseline = snapshot({ functions: { 'check_brand_limit()': 'trigger|v|true' } })
    const result = diffSchemas(legacy, baseline)

    expect(result.equivalent).toBe(false)
    expect(result.classes.triggers.onlyInLegacy).toEqual(['clients.enforce_brand_limit'])
    expect(result.classes.functions.changed).toEqual([])
  })

  it('catches an aeo_app grant difference', () => {
    const result = diffSchemas(
      snapshot({ grants: { scans: 'DELETE,INSERT,SELECT,UPDATE' } }),
      snapshot({ grants: { scans: 'SELECT' } }),
    )

    expect(result.equivalent).toBe(false)
    expect(result.classes.grants.changed).toHaveLength(1)
  })

  it('catches a policy appearing where the posture requires none', () => {
    const result = diffSchemas(
      snapshot({ rls: { client_reports: 'rowsecurity=true|policies=0' } }),
      snapshot({ rls: { client_reports: 'rowsecurity=true|policies=1' } }),
    )

    expect(result.equivalent).toBe(false)
    expect(result.classes.rls.changed).toHaveLength(1)
  })

  it('sorts reported keys so output is stable across runs', () => {
    const legacy = snapshot({ columns: { 'z.c': 'text|YES|', 'a.c': 'text|YES|' } })
    const result = diffSchemas(legacy, snapshot())

    expect(result.classes.columns.onlyInLegacy).toEqual(['a.c', 'z.c'])
  })
})
