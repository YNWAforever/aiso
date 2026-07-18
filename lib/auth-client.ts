'use client'
import { createAuthClient } from '@neondatabase/auth/next'

// Shared singleton — LoginForm, AccountUnlockCard, and AuthComplete use the same
// browser-side Neon Auth client; there's no per-component config to justify
// separate instances.
export const authClient = createAuthClient()

/**
 * Builds the callbackURL for a Neon Auth sign-in flow. Routes through
 * /{lang}/auth/complete so the client can exchange the session verifier for a
 * cookie on this domain before landing on `next` — see components/auth/AuthComplete.tsx
 * for why a direct callbackURL to the destination page doesn't work.
 */
export function buildAuthCompleteUrl(lang: string, next: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/${lang}/auth/complete?next=${encodeURIComponent(next)}`
}
