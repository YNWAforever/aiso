import { beforeEach, vi } from 'vitest'

export function installCiNetworkGuard() {
  // Keep explicit Vitest fetch mocks in place while still denying unmocked I/O.
  if (vi.isMockFunction(globalThis.fetch)) return

  vi.stubGlobal('fetch', () => {
    throw new Error('Network access is disabled in CI unit tests')
  })
}

if (process.env.CI) {
  beforeEach(installCiNetworkGuard)
}
