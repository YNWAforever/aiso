import { describe, expect, it } from 'vitest'

import {
  PRODUCTION_PROJECT_ID,
  assertEmptyPublicSchema,
  assertTargetIdentity,
  resolveTarget,
} from '../../scripts/bootstrap-project.mjs'

const TARGET = {
  projectId: 'weathered-wave-50814522',
  branchId: 'br-example-target',
  connectionUri: 'postgresql://user:pw@host/db',
}

const env = (over = {}) => ({
  BOOTSTRAP_PROJECT_ID: TARGET.projectId,
  BOOTSTRAP_BRANCH_ID: TARGET.branchId,
  BOOTSTRAP_DATABASE_URL: TARGET.connectionUri,
  ...over,
})

describe('resolveTarget', () => {
  it('returns the target when all three are set', () => {
    expect(resolveTarget(env())).toEqual(TARGET)
  })

  // No default, ever. A defaulted target is exactly how a stale environment
  // variable reaches a database nobody meant to touch.
  it.each(['BOOTSTRAP_PROJECT_ID', 'BOOTSTRAP_BRANCH_ID', 'BOOTSTRAP_DATABASE_URL'])(
    'refuses when %s is missing',
    (name) => {
      expect(() => resolveTarget(env({ [name]: undefined }))).toThrow(name)
    },
  )

  // Deploy environments substitute '' for a declared-but-valueless variable.
  it.each(['BOOTSTRAP_PROJECT_ID', 'BOOTSTRAP_BRANCH_ID', 'BOOTSTRAP_DATABASE_URL'])(
    'treats an empty %s as missing',
    (name) => {
      expect(() => resolveTarget(env({ [name]: '   ' }))).toThrow(name)
    },
  )
})

describe('assertTargetIdentity', () => {
  it('accepts a connection that reports the intended target', () => {
    expect(() =>
      assertTargetIdentity(TARGET, { projectId: TARGET.projectId, branchId: TARGET.branchId }),
    ).not.toThrow()
  })

  // Absent GUCs read as null. Fail closed rather than guess.
  it.each([
    ['project', { projectId: null, branchId: TARGET.branchId }],
    ['branch', { projectId: TARGET.projectId, branchId: null }],
  ])('refuses when the connection does not report its %s', (_label, reported) => {
    expect(() => assertTargetIdentity(TARGET, reported)).toThrow(/did not report/i)
  })

  // The one that matters most: production is refused by id, even if the caller
  // asked for it explicitly and the identity check would otherwise agree.
  it('refuses production even when it is the requested target', () => {
    const asking = { ...TARGET, projectId: PRODUCTION_PROJECT_ID }
    expect(() =>
      assertTargetIdentity(asking, {
        projectId: PRODUCTION_PROJECT_ID,
        branchId: TARGET.branchId,
      }),
    ).toThrow(/production/i)
  })

  it('refuses when the connection is somewhere other than the target', () => {
    expect(() =>
      assertTargetIdentity(TARGET, { projectId: 'other-project', branchId: 'br-elsewhere' }),
    ).toThrow(/but the target is/i)
  })
})

describe('assertEmptyPublicSchema', () => {
  it('accepts an empty schema', () => {
    expect(() => assertEmptyPublicSchema(0)).not.toThrow()
    expect(() => assertEmptyPublicSchema('0')).not.toThrow()
  })

  it('refuses a populated schema and says how to rebuild deliberately', () => {
    expect(() => assertEmptyPublicSchema(34)).toThrow(/34 table/)
    expect(() => assertEmptyPublicSchema(34)).toThrow(/drop schema public cascade/)
  })

  // Number() is the trap: Number(null), Number(''), Number([]) and
  // Number(false) are all 0, so without an explicit type check each of these
  // would read as "empty schema" and let the baseline apply over a database
  // that was never actually inspected. undefined is the only one Number()
  // rejects on its own.
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['an array', []],
    ['false', false],
    ['a non-numeric string', 'many'],
  ])('refuses %s rather than assuming zero', (_label, value) => {
    expect(() => assertEmptyPublicSchema(value)).toThrow(/could not read/i)
  })
})
