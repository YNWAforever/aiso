'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

type Props = {
  feature: string
  requiredPlan: string
  price: string
  children?: React.ReactNode
}

export function LockedFeature({ feature, requiredPlan, price, children }: Props) {
  const t = useTranslations('dashboard')
  const lang = useParams<{ lang?: string }>()?.lang ?? 'en'
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const planLabel = requiredPlan === 'Pro'
    ? t('plan_pro')
    : requiredPlan === 'Enterprise'
      ? t('plan_enterprise')
      : requiredPlan
  const content = <>
    <svg aria-hidden="true" className="mb-3 h-8 w-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
    <p className="text-sm font-semibold text-foreground">{feature}</p>
    <p className="mt-1 text-xs text-muted-foreground">{t('locked_available', { plan: planLabel, price })}</p>
    <button
      type="button"
      disabled={busy}
      aria-busy={busy}
      onClick={async () => {
        // One checkout per click, and never a silent dead button: any failure
        // falls back to the pricing page, which carries every upgrade path.
        if (busy) return
        setBusy(true)
        try {
          const res = await fetch('/api/stripe/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan: requiredPlan.toLowerCase(), lang }),
          })
          const data = res.ok ? await res.json().catch(() => null) : null
          // Stripe Checkout is an external URL; the pricing fallback is internal.
          if (typeof data?.url === 'string') window.location.href = data.url
          else if (res.status === 409) router.push(`/${lang}/dashboard/settings#billing`)
          else router.push(`/${lang}/pricing?plan=${encodeURIComponent(requiredPlan.toLowerCase())}`)
        } catch {
          router.push(`/${lang}/pricing?plan=${encodeURIComponent(requiredPlan.toLowerCase())}`)
        }
      }}
      className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {t('locked_upgrade', { plan: planLabel })}
    </button>
  </>

  if (!children) {
    return <div className="flex flex-col items-center rounded-xl border border-border bg-card p-6 text-center">{content}</div>
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card">
      <div className="pointer-events-none select-none opacity-20 blur-[2px]">{children}</div>
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-card/80 p-6 text-center">{content}</div>
    </div>
  )
}
