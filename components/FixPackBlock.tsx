'use client'
import { useState } from 'react'

interface Props {
  title: string
  content: string
  copyLabel: string
  copiedLabel: string
}

export function FixPackBlock({ title, content, copyLabel, copiedLabel }: Props) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200">
        <span className="text-sm font-semibold text-slate-700">{title}</span>
        <button
          onClick={handleCopy}
          className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
      <pre className="p-4 text-xs text-slate-800 overflow-x-auto whitespace-pre-wrap font-mono">
        {content}
      </pre>
    </div>
  )
}
