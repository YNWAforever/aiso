'use client'
import { useState } from 'react'
import { FixPackBlock } from '@/components/FixPackBlock'

interface Props {
  scanId: string
  fixCta: string
  fixSubtitle: string
  copyLabel: string
  copiedLabel: string
}

export function FixPackClient({ scanId, fixCta, fixSubtitle, copyLabel, copiedLabel }: Props) {
  const [loading, setLoading] = useState(false)
  const [fixPack, setFixPack] = useState<{ llms_txt: string; robots_patch: string; faq_schema: string } | null>(null)

  async function generate() {
    setLoading(true)
    const res = await fetch('/api/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanId }),
    })
    const data = await res.json()
    setFixPack(data)
    setLoading(false)
  }

  if (fixPack) {
    return (
      <div className="space-y-4">
        <FixPackBlock title="llms.txt"         content={fixPack.llms_txt}     copyLabel={copyLabel} copiedLabel={copiedLabel} />
        <FixPackBlock title="robots.txt patch" content={fixPack.robots_patch} copyLabel={copyLabel} copiedLabel={copiedLabel} />
        <FixPackBlock title="FAQ JSON-LD"      content={fixPack.faq_schema}   copyLabel={copyLabel} copiedLabel={copiedLabel} />
      </div>
    )
  }

  return (
    <div className="bg-blue-600 rounded-xl p-6 text-center">
      <button
        onClick={generate}
        disabled={loading}
        className="text-white font-bold text-lg disabled:opacity-70"
      >
        {loading ? '…' : fixCta}
      </button>
      <p className="text-blue-200 text-sm mt-1">{fixSubtitle}</p>
    </div>
  )
}
