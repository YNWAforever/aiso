import { describe, expect, it } from 'vitest'
import { CHECK_EXPLANATIONS, CHECK_EXPLANATIONS_ZH_HK } from '@/lib/checkExplanations'
import { CHECK_KEYS } from '@/lib/types'

const RECORDS = [
  ['en', CHECK_EXPLANATIONS],
  ['zh-HK', CHECK_EXPLANATIONS_ZH_HK],
] as const

const FIELDS = ['question', 'why'] as const
const FIX_FIELDS = ['pass', 'warn', 'fail'] as const

describe('check explanation parity', () => {
  // The expected id list comes from lib/types.ts, NOT from
  // Object.keys(CHECK_EXPLANATIONS). Deriving the expectation from the object
  // under test makes the guard circular -- it would pass with a check missing
  // from BOTH locales, which is exactly the case worth catching.
  it.each(RECORDS)('%s has every check id with no empty field', (_locale, record) => {
    const missing = CHECK_KEYS.filter(id => !(id in record))
    expect(missing).toEqual([])

    const empty: string[] = []
    for (const id of CHECK_KEYS) {
      const entry = record[id]
      if (!entry) continue
      for (const field of FIELDS) {
        if (!entry[field]?.trim()) empty.push(`${id}.${field}`)
      }
      for (const field of FIX_FIELDS) {
        if (!entry.fix?.[field]?.trim()) empty.push(`${id}.fix.${field}`)
      }
    }
    expect(empty).toEqual([])
  })

  it('both locales cover exactly the same ids', () => {
    expect(Object.keys(CHECK_EXPLANATIONS_ZH_HK).sort())
      .toEqual(Object.keys(CHECK_EXPLANATIONS).sort())
  })

  // Guards the guard: if CHECK_KEYS ever shrank to the 16 keys of ScanResults
  // alone -- the GEO checks c17-c20 live in a separate interface -- every
  // assertion above would still pass while silently ignoring a fifth of them.
  it('CHECK_KEYS covers all twenty checks, including the GEO ones', () => {
    expect(CHECK_KEYS).toHaveLength(20)
    expect(CHECK_KEYS).toContain('c17_citation_density')
    expect(CHECK_KEYS).toContain('c20_chunkability')
  })
})
