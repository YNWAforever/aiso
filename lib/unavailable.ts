import { NextResponse } from 'next/server'

/**
 * An honest 503 for a feature whose implementation was removed during the
 * Supabase to Neon migration. Fenced routes fail fast and legibly instead of
 * hanging against a hostname that no longer resolves.
 *
 * Restoring a fenced feature means porting its queries to db() — see
 * docs/superpowers/specs/2026-07-26-critical-path-to-production-design.md.
 */
export function featureUnavailable(feature: string): NextResponse {
  return NextResponse.json({ error: 'FEATURE_UNAVAILABLE', feature }, { status: 503 })
}
