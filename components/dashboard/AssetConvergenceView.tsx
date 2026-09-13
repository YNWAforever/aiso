'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { AssetConvergence } from '@/lib/view-models/asset-convergence'
import type { MergeSuggestion } from '@/lib/assets/merge-suggestions'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

/**
 * Registered pages, each with the findings and questions that reach it.
 *
 * The scope labels are not decoration. A scan observed the SITE — `origin-only.v1`
 * kept no path — so a finding listed under a page says so on the line beneath it.
 * A declared question is the owner's own statement about that page, and says that
 * instead. Losing either label would turn this screen into a claim that the
 * product observed something it never did.
 */
export function AssetConvergenceView({
  convergence,
  suggestions,
  lang,
  clientId,
}: {
  convergence: AssetConvergence[]
  suggestions: MergeSuggestion[]
  lang: string
  clientId: string
}) {
  const copy = (lang === 'zh-HK' ? zhHK : en).assets
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function register(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setFailed(false)
    try {
      const response = await fetch(`/api/dashboard/clients/${clientId}/assets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, label }),
      })
      if (!response.ok) {
        setFailed(true)
        return
      }
      setUrl('')
      setLabel('')
      router.refresh()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl space-y-8 break-words px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-2xl font-bold text-foreground">{copy.title}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">{copy.intro}</p>
      </header>

      <section aria-labelledby="asset-add" className="rounded-xl border border-border bg-card p-6">
        <h2 id="asset-add" className="text-lg font-bold text-foreground">{copy.addTitle}</h2>
        <form onSubmit={register} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-foreground">{copy.urlLabel}</span>
            <input
              name="url" type="url" required value={url} onChange={event => setUrl(event.target.value)}
              className="h-11 w-full rounded-lg border border-border bg-background px-4 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-foreground">{copy.labelLabel}</span>
            <input
              name="label" required value={label} onChange={event => setLabel(event.target.value)}
              className="h-11 w-full rounded-lg border border-border bg-background px-4 text-sm"
            />
          </label>
          <button
            type="submit" disabled={busy}
            className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40 sm:col-span-2 sm:justify-self-start"
          >
            {busy ? copy.submitting : copy.submit}
          </button>
        </form>
        {failed && <p className="mt-3 text-sm text-muted-foreground">{copy.error}</p>}
      </section>

      {convergence.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul className="space-y-4">
          {convergence.map(entry => {
            const suggestion = suggestions.find(candidate => candidate.assetId === entry.asset.id)
            return (
            <li key={entry.asset.id} className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-base font-bold text-foreground">{entry.asset.label}</h2>
              <p className="mt-1 break-all text-xs text-muted-foreground">{entry.asset.url}</p>
              {entry.converges && (
                <p className="mt-3 rounded-lg border border-border p-3 text-sm font-semibold text-foreground">
                  {copy.converges}
                </p>
              )}
              {suggestion && (
                suggestion.mergeable ? (
                  <div className="mt-3 rounded-lg border border-border p-3 text-sm text-foreground">
                    <p className="font-semibold">{copy.suggestionTitle}</p>
                    <p className="mt-1 text-muted-foreground">{copy.suggestionBody}</p>
                  </div>
                ) : (
                  <p className="mt-3 rounded-lg border border-border p-3 text-sm text-muted-foreground">
                    {copy.suggestionBothDrafted}
                  </p>
                )
              )}

              <h3 className="mt-5 text-sm font-semibold text-foreground">{copy.findingsTitle}</h3>
              <p className="text-xs text-muted-foreground">{copy.findingsScope}</p>
              {entry.findings.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">{copy.findingsEmpty}</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {entry.findings.map(finding => (
                    <li key={finding.checkKey} className="flex min-h-11 items-center gap-2 text-sm text-foreground">
                      <span>{finding.checkKey}</span>
                      <span className="text-xs text-muted-foreground">({finding.status})</span>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="mt-5 text-sm font-semibold text-foreground">{copy.questionsTitle}</h3>
              <p className="text-xs text-muted-foreground">{copy.questionsScope}</p>
              {entry.questions.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">{copy.questionsEmpty}</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {entry.questions.map(question => (
                    <li key={question.promptId} className="flex min-h-11 items-center text-sm text-foreground">
                      {question.question}
                    </li>
                  ))}
                </ul>
              )}
            </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
