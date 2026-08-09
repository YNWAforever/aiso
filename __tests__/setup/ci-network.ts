import { beforeEach, vi } from 'vitest'

export function installCiNetworkGuard() {
  vi.stubGlobal('fetch', () => {
    throw new Error('Network access is disabled in CI unit tests')
  })
}

if (process.env.CI) {
  beforeEach(installCiNetworkGuard)
}
