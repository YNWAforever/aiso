'use client'
import { useState } from 'react'
import { useLocale } from 'next-intl'
import { Share2, Check } from 'lucide-react'

const COPY_EN = {
  shareText: (domain: string, score: number, grade: string) =>
    `${domain} scored ${score}/100 (${grade}) on AI visibility — scanned with Fimmick AISO`,
  shareTitle: (domain: string) => `AI visibility score for ${domain}`,
  copied: 'Link copied',
  share: 'Share',
}

const COPY_ZH_HK: typeof COPY_EN = {
  shareText: (domain: string, score: number, grade: string) =>
    `${domain} 的 AI 可見度分數為 ${score}/100（${grade}）——以 Fimmick AISO 掃描`,
  shareTitle: (domain: string) => `${domain} 的 AI 可見度分數`,
  copied: '已複製連結',
  share: '分享',
}

interface Props {
  domain: string
  score: number
  grade: string
}

/** Web Share API with clipboard fallback — nudges the OG-card acquisition loop */
export function ShareButton({ domain, score, grade }: Props) {
  const locale = useLocale()
  const c = locale === 'zh-HK' ? COPY_ZH_HK : COPY_EN
  const [copied, setCopied] = useState(false)

  async function share() {
    const url = window.location.href
    const text = c.shareText(domain, score, grade)
    if (navigator.share) {
      try {
        await navigator.share({ title: c.shareTitle(domain), text, url })
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
      {copied ? c.copied : c.share}
    </button>
  )
}
