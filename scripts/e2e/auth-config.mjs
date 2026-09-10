/**
 * Whether the authenticated E2E journey can run, and if not, precisely why.
 *
 * One definition, used by both the capture tool and the runner. Duplicating it is
 * how they drifted: each had its own bare "is it set" test, neither checked the
 * SHAPE of the value, and a Postgres connection string pasted into
 * NEON_AUTH_BASE_URL passed both. That is not hypothetical — it happened, and the
 * symptom would have been a browser opening, a sign-in silently failing, and a
 * ten-minute timeout naming nothing.
 *
 * Pure on purpose: it reads no environment and opens no file, so a test can hand
 * it the exact bad value and assert the exact diagnosis, rather than grepping
 * this source for a string it hopes is there.
 */

export const DEFAULT_STATE_PATH = '.auth/owner-state.json'

/**
 * @param {{ baseUrl?: string, statePath?: string, stateExists?: boolean }} input
 * @returns {{ blockers: string[] }} empty when the journey can run
 */
export function describeAuthConfig({ baseUrl, statePath = DEFAULT_STATE_PATH, stateExists = false }) {
  const blockers = []

  const value = typeof baseUrl === 'string' ? baseUrl.trim().replace(/^["']|["']$/g, '') : ''
  if (!value) {
    blockers.push([
      'NEON_AUTH_BASE_URL is not set in .env.local.',
      '     Without it getProfile() cannot resolve a session and every authenticated',
      '     route answers 503, so even a captured session would prove nothing.',
      '     .env.local is gitignored, so each git worktree keeps its own copy —',
      '     setting it in another checkout does not set it here.',
    ].join('\n'))
  } else {
    let parsed = null
    try {
      parsed = new URL(value)
    } catch {
      blockers.push([
        'NEON_AUTH_BASE_URL is not a URL.',
        '     It is the base URL of the Neon Auth service, from the Neon console.',
      ].join('\n'))
    }

    if (parsed && parsed.protocol !== 'https:') {
      // Name the mistake that actually gets made. A DSN in this slot is worse
      // than a typo: it carries a password, and the value is handed to the auth
      // SDK as an issuer base URL.
      const looksLikeDatabaseUrl = parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:'
      blockers.push([
        `NEON_AUTH_BASE_URL is ${parsed.protocol}//... — it must be https://...`,
        ...(looksLikeDatabaseUrl
          ? [
            '     That is a database connection string, not an auth base URL. It also',
            '     carries a password, so remove it from this variable. DATABASE_URL and',
            '     MIGRATE_DATABASE_URL are where a DSN belongs.',
          ]
          : []),
        '     lib/readiness/config.ts validates this as https, and lib/neon-auth.ts',
        '     passes it to the SDK as the issuer base URL.',
      ].join('\n'))
    }
  }

  if (!stateExists) {
    blockers.push([
      `No captured session at ${statePath}.`,
      '     Run: npm run e2e:auth:capture',
      '     It opens a browser and waits for YOU to sign in — magic link or Google.',
      '     It types nothing on your behalf; this product has no password sign-in.',
    ].join('\n'))
  }

  return { blockers }
}

/** The shared refusal text, so both entry points fail the same way. */
export function formatRefusal(blockers) {
  return [
    '',
    'The authenticated owner journey (AC-14) cannot run yet.',
    '',
    ...blockers.map((blocker, index) => `  ${index + 1}. ${blocker}`),
    '',
    'This is the one gate in the suite a machine cannot satisfy on its own.',
    '',
  ].join('\n')
}
