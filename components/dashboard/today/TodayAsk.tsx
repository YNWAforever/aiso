'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * The Today composer: one question, one button. It never writes by itself — it
 * opens Chat with the question filled in, so the save/quota behaviour stays the
 * conversation's existing one.
 */
export function TodayAsk({ lang, clientId, label, placeholder, cta, hint }: {
  lang: string
  clientId: string
  label: string
  placeholder: string
  cta: string
  hint: string
}) {
  const [value, setValue] = useState('')
  const router = useRouter()
  return (
    <form
      onSubmit={event => {
        event.preventDefault()
        const question = value.trim()
        if (!question) return
        router.push(`/${lang}/dashboard/${encodeURIComponent(clientId)}/studio?ask=${encodeURIComponent(question)}`)
      }}
      className="rounded-2xl border border-border bg-card p-5 shadow-e1 sm:p-6"
    >
      <label htmlFor="today-ask" className="block text-sm font-semibold text-foreground">{label}</label>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <textarea
          id="today-ask"
          name="ask"
          rows={2}
          maxLength={1000}
          value={value}
          onChange={event => setValue(event.target.value)}
          placeholder={placeholder}
          className="min-h-11 w-full flex-1 resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
        <button
          type="submit"
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary-accessible focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
          disabled={value.trim().length === 0}
        >
          {cta}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
    </form>
  )
}
