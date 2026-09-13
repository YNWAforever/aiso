import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Without this, the following silently passes: createDraftIfEvidenceCurrent's CTE in
 * lib/work-items/store.ts and runCreateDraftCte's hand-copied reproduction of it in
 * __tests__/integration/work-item-sources.test.ts are two independent pieces of text
 * with nothing linking them. Rename source_ins, change the on-conflict target, or
 * replace source_ins's `from mutation` with a scalar subquery -- reintroducing the
 * exact race this design closes -- and both the mocked unit tests (which only ever
 * string-match the store's own query text) and the integration test (which only ever
 * runs its own hand-copied SQL) stay green. Neither one would notice the guarantee
 * stopped applying to the real store.
 *
 * This is a TEXT check, not a behavioural one: it proves nothing about what Postgres
 * actually does with either statement -- __tests__/integration/work-item-sources.test.ts
 * already owns that proof. All this file does is stop the store's CTE and its
 * integration reproduction from drifting apart unnoticed.
 */

const storeSource = readFileSync(join(process.cwd(), 'lib/work-items/store.ts'), 'utf8')
const integrationSource = readFileSync(
  join(process.cwd(), '__tests__/integration/work-item-sources.test.ts'),
  'utf8',
)

const SHARED_MARKERS = [
  'with mutation as (',
  ', source_ins as (',
  'insert into work_item_sources',
  'from mutation',
]

describe('the store CTE and its integration reproduction share one structural shape', () => {
  it.each(SHARED_MARKERS)('both files contain %j', (marker) => {
    expect(storeSource).toContain(marker)
    expect(integrationSource).toContain(marker)
  })

  it('both files close the CTE with a select that reads only from mutation', () => {
    // Derived from the store, not hardcoded a second time: lib/work-items/sources.ts's
    // rule against bare `select *` on a statement that joins means the store's trailing
    // select now names mutation's columns explicitly (Finding 2's fix), while this
    // integration file's runCreateDraftCte is deliberately left as `select * from
    // mutation` -- this test reads that file, it does not rewrite its SQL. So the two
    // are no longer byte-identical, and pinning the store's exact column list here as a
    // second literal would only hand this test its own copy to drift from unnoticed.
    // What both must still share is the shape: a plain select of some column list (star
    // or named) over `mutation` alone, never `source_ins`, never a join.
    const trailingSelectShape = /select [\w,* ]+ from mutation\b/
    const storeFinalSelect = storeSource.match(trailingSelectShape)?.[0]
    expect(storeFinalSelect).toBeTruthy()
    expect(storeFinalSelect).not.toBe('select * from mutation')
    expect(integrationSource).toMatch(trailingSelectShape)
  })
})
