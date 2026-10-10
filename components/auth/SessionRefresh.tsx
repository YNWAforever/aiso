'use client'
import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

/** Renew only after a protected layout's server gate has accepted the user. */
export function SessionRefresh() {
  const pathname = usePathname()
  const router = useRouter()
  useEffect(() => {
    let active = true
    void authClient.getSession({ query: { disableCookieCache: true } }).then(({ data, error }) => {
      if (!active) return
      if (error) {
        console.warn('[auth] session renewal unavailable', { status: typeof error.status === 'number' ? error.status : null })
        return
      }
      // Re-run the authoritative server gate; its trusted path preserves the
      // current tool for login. Service failures never take this branch.
      if (!data?.session || !data.user) router.refresh()
    }).catch(() => {
      if (active) console.warn('[auth] session renewal unavailable', { status: null })
    })
    return () => { active = false }
  }, [pathname, router])
  return null
}
