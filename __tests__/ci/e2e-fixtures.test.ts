import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  E2E_FIXTURE_SCAN_ID,
  getE2EScanFixture,
} from '../../lib/e2e-fixtures'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('E2E scan fixture', () => {
  it('returns a stable scan with core, extended, and GEO results in fixture mode', () => {
    vi.stubEnv('E2E_FIXTURE_MODE', '1')

    const fixture = getE2EScanFixture(E2E_FIXTURE_SCAN_ID)

    expect(fixture).toMatchObject({
      id: E2E_FIXTURE_SCAN_ID,
      url: 'https://e2e-test.example.com',
      domain: 'e2e-test.example.com',
    })
    expect(fixture?.results).toMatchObject({
      c1_robots: expect.any(Object),
      c6_llms_full_txt: expect.any(Object),
      c17_citation_density: expect.any(Object),
    })
  })

  it('is disabled by default', () => {
    vi.stubEnv('E2E_FIXTURE_MODE', '')

    expect(getE2EScanFixture(E2E_FIXTURE_SCAN_ID)).toBeNull()
  })

  it('returns null for an unrecognized scan ID', () => {
    vi.stubEnv('E2E_FIXTURE_MODE', '1')

    expect(getE2EScanFixture('00000000-dead-beef-0000-000000000000')).toBeNull()
  })
})
