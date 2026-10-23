'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { consumeOneTimeFunnelEvent, trackFunnelEvent } from '@/lib/funnel-client'
import { funnelLocale } from './funnel-locale'

/** The upgrade prompt's link: records the prompt once when shown and again when followed. */
export function TrackedUpgradeLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  const viewed = useRef(false)
  useEffect(() => {
    if (consumeOneTimeFunnelEvent(viewed)) trackFunnelEvent({ name: 'upgrade_prompt_viewed', locale: funnelLocale() })
  }, [])
  return (
    <a href={href} className={className} onClick={() => trackFunnelEvent({ name: 'upgrade_prompt_clicked', locale: funnelLocale() })}>
      {children}
    </a>
  )
}
