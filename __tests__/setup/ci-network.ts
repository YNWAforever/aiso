import { vi } from 'vitest'

if (process.env.CI) {
  vi.stubGlobal('fetch', () => {
    throw new Error('Network access is disabled in CI unit tests')
  })
}
