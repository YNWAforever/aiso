import {projectScanStatus} from '../../lib/view-models/scan-status'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  E2E_FIXTURE_SCAN,
  E2E_FIXTURE_SCAN_ID,
  getE2EScanFixture,
} from '../../lib/e2e-fixtures'
import { assignGrade } from '../../lib/scoring'

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

it('numeric success fixture carries validated synthetic page evidence while missing evidence remains unknown',()=>{vi.stubEnv('E2E_FIXTURE_MODE','1');const scan=getE2EScanFixture(E2E_FIXTURE_SCAN_ID)!;expect(projectScanStatus({score:scan.score??null,grade:scan.grade??null,evidence:scan.results.evidence}).score).toBe(63.5);expect(projectScanStatus({score:scan.score??null,grade:scan.grade??null,evidence:undefined})).toMatchObject({state:'unknown',score:null})});
it('fixture grade is the one the scorer assigns to its score',()=>{expect(E2E_FIXTURE_SCAN.grade).toBe(assignGrade(E2E_FIXTURE_SCAN.score!))});
