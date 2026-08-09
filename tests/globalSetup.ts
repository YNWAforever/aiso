import { TEST_SCAN_ID } from './constants'

export { TEST_SCAN_ID }

export default async function globalSetup() {
  if (process.env.E2E_FIXTURE_MODE !== '1') {
    if (process.env.CI) throw new Error('E2E_FIXTURE_MODE=1 is required for CI E2E tests')
    console.warn('[globalSetup] E2E fixture mode is disabled; no fixture is available.')
    return
  }

  console.log(`[globalSetup] In-memory E2E fixture ready — ID: ${TEST_SCAN_ID}`)
}
