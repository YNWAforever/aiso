import { createNeonAuth } from '@neondatabase/auth/next/server'

// Lazy singleton — createNeonAuth is deferred until first use so that
// module evaluation at Next.js build time (when env vars may be absent)
// does not throw.
type NeonAuthInstance = ReturnType<typeof createNeonAuth>

let _instance: NeonAuthInstance | null = null

/**
 * Reads a required Neon Auth variable, or throws naming it.
 *
 * The `!` assertions this replaced turned a missing variable into the SDK's own
 * "Missing required config: cookies.secret", which names a config key but not
 * the environment variable an operator has to set. That mattered more once
 * app/api/auth/[...path]/route.ts stopped constructing the handler at module
 * scope: the failure now surfaces on the first request rather than failing the
 * build, so it has to say what to do about it.
 *
 * `?.trim() ||` rather than `??`: deploy environments substitute '' for a
 * variable that is declared but never given a value, and '' is not a usable
 * secret. Never include the value in the message -- only the name.
 */
function requiredEnv(name: 'NEON_AUTH_BASE_URL' | 'NEON_AUTH_COOKIE_SECRET'): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(
      `${name} is not set (or is empty). Neon Auth cannot be constructed without it, ` +
      'so every /api/auth/* request will fail. Set it in this environment.',
    )
  }
  return value
}

export function auth(): NeonAuthInstance {
  if (!_instance) {
    const secret = requiredEnv('NEON_AUTH_COOKIE_SECRET')
    // The SDK enforces this too, but its message does not name the variable.
    // Reporting the length is safe; reporting the value would not be.
    if (secret.length < 32) {
      throw new Error(
        `NEON_AUTH_COOKIE_SECRET must be at least 32 characters; it is ${secret.length}.`,
      )
    }
    _instance = createNeonAuth({
      baseUrl: requiredEnv('NEON_AUTH_BASE_URL'),
      cookies: { secret },
    })
  }
  return _instance
}
