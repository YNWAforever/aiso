import { describe, expect, it } from 'vitest'
import ordinary from '../../vitest.integration.config'

describe('exact-target work-item integration configuration', () => {
  it('excludes work-item target tests from automatic branch provisioning', () => {
    expect(ordinary.test?.exclude).toContain('__tests__/integration/evidence-work-items.test.ts')
  })

  it('has a dedicated opt-in suite without provisioning or environment setup', async () => {
    const {default: config} = await import('../../vitest.work-items-integration.config')
    expect(config.test?.include).toEqual(['__tests__/integration/evidence-work-items.test.ts'])
    expect(config.test?.globalSetup ?? []).toEqual([])
    expect(config.test?.setupFiles ?? []).toEqual([])
  })
})
