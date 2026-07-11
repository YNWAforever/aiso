import { createNeonAuth } from '@neondatabase/auth/next/server'

// Lazy singleton — createNeonAuth is deferred until first use so that
// module evaluation at Next.js build time (when env vars may be absent)
// does not throw.
type NeonAuthInstance = ReturnType<typeof createNeonAuth>

let _instance: NeonAuthInstance | null = null

export function auth(): NeonAuthInstance {
  if (!_instance) {
    _instance = createNeonAuth({
      baseUrl: process.env.NEON_AUTH_BASE_URL!,
      cookies: {
        secret: process.env.NEON_AUTH_COOKIE_SECRET!,
      },
    })
  }
  return _instance
}
