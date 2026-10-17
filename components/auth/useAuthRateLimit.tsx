'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AuthRateLimitError, authRetryAfter } from '@/lib/auth-rate-limit'

export function useAuthRateLimit() {
  const t = useTranslations('authRateLimit')
  const [deadline, setDeadline] = useState<number | null | undefined>()
  const [remaining, setRemaining] = useState(0)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  useEffect(() => {
    if (deadline === undefined || deadline === null) return
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [deadline])
  const captureAuthLimit = useCallback(async (response: Response): Promise<AuthRateLimitError | null> => {
    if (response.status !== 429) return null
    const body: unknown = await response.clone().json().catch(() => null)
    if (!body || typeof body !== 'object' || !('error' in body) || body.error !== 'AUTH_RATE_LIMITED') return null
    let seconds = authRetryAfter(response.headers)
    if (seconds === null && 'retryAfterSeconds' in body && typeof body.retryAfterSeconds === 'number') {
      seconds = authRetryAfter(new Headers({ 'Retry-After': String(body.retryAfterSeconds) }))
    }
    if (active.current) {
      setRemaining(seconds ?? 0)
      setDeadline(seconds === null ? null : Date.now() + seconds * 1000)
    }
    return new AuthRateLimitError(seconds)
  }, [])
  const clearAuthLimit = useCallback(() => {
    if (active.current) setDeadline(current =>
      typeof current === 'number' && current > Date.now() ? current : undefined)
  }, [])
  const authNotice = deadline === undefined ? null : (
    <div role="alert" className="space-y-2 rounded-lg border border-border bg-card p-4">
      <p>{t('message')}</p>
      <p role="status">{deadline === null ? t('unknown') : remaining > 0 ? t('retryIn', { seconds: remaining }) : t('ready')}</p>
    </div>
  )
  return { captureAuthLimit, clearAuthLimit, authWaiting: deadline !== undefined && deadline !== null && remaining > 0, authNotice }
}
