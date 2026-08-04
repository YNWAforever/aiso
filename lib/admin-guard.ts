import { NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import type { ProfileWithAccount } from '@/lib/types'

// Route-handler flavour of requireAdmin(). lib/auth.ts's requireAdmin() calls
// redirect(), which is correct for Server Components and layouts but produces a
// redirect rather than a status code inside an API route.
export type AdminGuardResult =
  | { ok: true;  profile: ProfileWithAccount }
  | { ok: false; response: NextResponse }

export async function requireApiAdmin(): Promise<AdminGuardResult> {
  // getProfile() throws when the session store itself is unavailable (see the
  // `if (error) throw error` in lib/auth.ts). That rejection is deliberately
  // left to propagate — surfacing as Next's 500 — rather than being caught and
  // turned into an { ok: false } response. Swallowing it would downgrade a
  // session-store outage into an indistinguishable 401/403.
  const profile = await getProfile()
  if (!profile) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!profile.is_admin) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true, profile }
}
