'use client'
import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

interface Props { title: string; content: string; copyLabel: string; copiedLabel: string }
export function FixPackBlock({ title, content, copyLabel, copiedLabel }: Props) {
  const t = useTranslations('generatedWork')
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const [copying, setCopying] = useState(false)
  const pending = useRef(false)
  async function handleCopy() {
    if (pending.current) return
    pending.current = true
    setCopied(false); setFailed(false); setCopying(true)
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
    } catch { setFailed(true) }
    finally { pending.current = false; setCopying(false) }
  }
  return <div className="overflow-hidden rounded-lg border border-dash-border">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dash-border bg-dash-elevated px-4 py-2">
      <span className="text-sm font-semibold text-dash-text">{title}</span>
      <button type="button" onClick={handleCopy} disabled={copying} aria-label={`${copyLabel}: ${title}`} className="min-h-11 rounded bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-70">
        {copying ? t('copying') : copied ? copiedLabel : copyLabel}
      </button>
    </div>
    <pre className="overflow-x-auto whitespace-pre-wrap break-words p-4 font-mono text-xs text-dash-text">{content}</pre>
    <p role="status" className="px-4 pb-3 text-xs text-dash-muted">{failed ? t('copyFailed') : copied ? copiedLabel : ''}</p>
  </div>
}
