'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Share2, Check } from 'lucide-react'
import { formatScanScore } from '@/lib/score-display'

interface Props {
  domain: string
  score: number
  grade: string
}

/** Web Share API with clipboard fallback. The shared link carries the score as its OG image. */
export function ShareButton({ domain, score, grade }: Props) {
  const t = useTranslations('resultPage')
  const [copied, setCopied] = useState(false)

  async function share() {
    const url = window.location.href
    const text = t('share_text', { domain, score: formatScanScore(score), grade })
    if (navigator.share) {
      try {
        await navigator.share({ title: t('share_title', { domain }), text, url })
        return
      } catch { /* user cancelled — fall through to copy */ }
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable */ }
  }

  return (
    <button
      type="button"
      onClick={share}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold text-foreground hover:bg-neutral-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {copied ? <Check aria-hidden="true" className="size-3.5 text-tone-success-fg" /> : <Share2 aria-hidden="true" className="size-3.5" />}
      <span aria-live="polite" className="sr-only sm:not-sr-only">{copied ? t('share_copied') : t('share')}</span>
    </button>
  )
}
