'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

type Copy = {
  language: string; narrative: string; save: string; failed: string; brandingRequired: string; invalidNarrative: string
  aiDraft: string; aiDrafting: string; aiDraftNote: string; aiDraftUnavailable: string; aiDraftInvalid: string; aiDraftFirstSave: string
}

/**
 * Saves a draft (a new version) of the month's report, then re-reads the page.
 * The AI button only fills the textarea: wording becomes a version when the
 * operator saves it, never before.
 */
export function MonthlyReportEditor({ clientId, month, locale, narrative, hasDraft, copy }: {
  clientId: string; month: string; locale: 'en' | 'zh-HK'; narrative: string | null; hasDraft: boolean; copy: Copy
}) {
  const router = useRouter()
  const [lang, setLang] = useState(locale)
  const [text, setText] = useState(narrative ?? '')
  const [busy, setBusy] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  async function save() {
    setBusy(true); setError(null); setNotice(null)
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/months/${encodeURIComponent(month)}/report`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(text.trim() ? { locale: lang, narrative: text } : { locale: lang }),
      })
      if (!res.ok) {
        const code = (await res.json().catch(() => ({})) as { error?: string }).error
        setError(code === 'BRANDING_REQUIRED' ? copy.brandingRequired : code === 'INVALID_NARRATIVE' ? copy.invalidNarrative : copy.failed)
        return
      }
      router.refresh()
    } catch { setError(copy.failed) } finally { setBusy(false) }
  }
  async function draft() {
    setDrafting(true); setError(null); setNotice(null)
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/months/${encodeURIComponent(month)}/report/ai-narrative`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: lang }),
      })
      if (res.status === 409) { setError(copy.aiDraftFirstSave); return }
      if (!res.ok) { setError(copy.aiDraftUnavailable); return }
      const result = await res.json() as { narrative?: unknown; code?: unknown }
      if (typeof result.narrative !== 'string' || !result.narrative.trim()) { setError(copy.aiDraftUnavailable); return }
      if (result.code === 'ai_invalid_output') { setError(copy.aiDraftInvalid); return }
      setText(result.narrative)
      setNotice(result.code === 'ai_polished' ? copy.aiDraftNote : copy.aiDraftUnavailable)
    } catch { setError(copy.aiDraftUnavailable) } finally { setDrafting(false) }
  }
  const pending = busy || drafting
  return (
    <form className="space-y-3 rounded-lg border border-border p-5" onSubmit={e => { e.preventDefault(); void save() }}>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">{copy.language}</span>
        <select className="block min-h-11 rounded-md border border-border bg-background px-3" value={lang} onChange={e => setLang(e.target.value as 'en' | 'zh-HK')}>
          <option value="en">English</option>
          <option value="zh-HK">繁體中文</option>
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">{copy.narrative}</span>
        <textarea className="block min-h-32 w-full rounded-md border border-border bg-background p-3" maxLength={1200} value={text} onChange={e => setText(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="min-h-11" disabled={pending} aria-busy={busy}>{copy.save}</Button>
        <Button type="button" variant="outline" className="min-h-11" disabled={pending || !hasDraft} aria-busy={drafting}
          title={hasDraft ? undefined : copy.aiDraftFirstSave} onClick={() => void draft()}>
          {drafting ? copy.aiDrafting : copy.aiDraft}
        </Button>
      </div>
      {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm text-tone-danger-fg">{error}</p> : null}
    </form>
  )
}
