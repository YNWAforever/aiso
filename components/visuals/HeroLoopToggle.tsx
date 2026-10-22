'use client'
import { useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { useTranslations } from 'next-intl'

/**
 * Pause / play for the CSS hero loop (WCAG 2.2.2: the loop runs longer than
 * five seconds). Pausing sets `data-paused` on the enclosing `.hero-loop`,
 * which freezes every keyframe in place via animation-play-state. Hidden when
 * reduced motion is requested, since nothing moves then (app/globals.css).
 */
export function HeroLoopToggle() {
  const t = useTranslations('visuals.heroDemo')
  const [paused, setPaused] = useState(false)

  function toggle(event: React.MouseEvent<HTMLButtonElement>) {
    const loop = event.currentTarget.closest('.hero-loop')
    const next = !paused
    loop?.toggleAttribute('data-paused', next)
    setPaused(next)
  }

  const Icon = paused ? Play : Pause
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={paused ? t('play') : t('pause')}
      title={paused ? t('play') : t('pause')}
      className="hero-loop-toggle absolute right-2 top-1.5 z-10 inline-flex size-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-e1 transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <Icon aria-hidden="true" className="size-3.5" />
    </button>
  )
}
