'use client'
import { useState } from 'react'
import { Share2, Check } from 'lucide-react'

interface Props {
  domain: string
  score: number
  grade: string
}

/** Web Share API with clipboard fallback — nudges the OG-card acquisition loop */
export function ShareButton({ domain, score, grade }: Props) {
  const [copied, setCopied] = useState(false)

  async function share() {
    const url = window.location.href
    const text = `${domain} scored ${score}/100 (${grade}) on AI visibility — scanned with Fimmick AISO`
    if (navigator.share) {
      try {
        await navigator.share({ title: `AI visibility score for ${domain}`, text, url })
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
      onClick={share}
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition"
    >
      {copied ? <Check className="size-3.5 text-emerald-600" /> : <Share2 className="size-3.5" />}
      {copied ? 'Link copied' : 'Share'}
    </button>
  )
}
