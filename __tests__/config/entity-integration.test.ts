import { describe, expect, it } from 'vitest'
import ordinary from '../../vitest.integration.config'

describe('exact-target entity integration configuration', () => {
  it('excludes entity target tests from automatic branch provisioning', () => {
    expect(ordinary.test?.exclude).toContain('__tests__/integration/client-entities.test.ts')
  })
  it('has a dedicated opt-in suite without provisioning hooks', async () => {
    const {default: config} = await import('../../vitest.entity-integration.config')
    expect(config.test?.include).toEqual(['__tests__/integration/client-entities.test.ts'])
    expect(config.test?.globalSetup ?? []).toEqual([])
    expect(config.test?.setupFiles ?? []).toEqual([])
  })
})
