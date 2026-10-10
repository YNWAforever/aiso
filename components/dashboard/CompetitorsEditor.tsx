'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  removeCompetitor, saveCompetitor, splitList,
  type CompetitorErrorKey, type CompetitorView,
} from '@/lib/competitors/client'

type Row = { key: string; id: string | null; legacyName: string | null; name: string; aliases: string; domains: string }
type Notice = { kind: 'status' | 'alert'; text: string } | null

const toRow = (c: CompetitorView, index: number): Row => ({
  key: c.id ?? `legacy-${index}-${c.name}`,
  id: c.id,
  legacyName: c.id ? null : c.name,
  name: c.name,
  aliases: c.aliases.join(', '),
  domains: c.domains.join(', '),
})

/**
 * Edits a brand's competitors: name, other spellings and websites. Names
 * added during onboarding arrive without a row (`id: null`) and are saved on
 * first edit; lib/competitors/client.ts handles that.
 */
export function CompetitorsEditor({
  clientId, initialCompetitors, max,
}: { clientId: string; initialCompetitors: CompetitorView[]; max: number }) {
  const t = useTranslations('competitors')
  const formId = useId()
  const [rows, setRows] = useState<Row[]>(() => initialCompetitors.map(toRow))
  const [draft, setDraft] = useState({ name: '', aliases: '', domains: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)

  const fail = (error: CompetitorErrorKey) => setNotice({ kind: 'alert', text: t(error, { max }) })
  const update = (key: string, patch: Partial<Row>) => setRows(current => current.map(r => r.key === key ? { ...r, ...patch } : r))

  async function save(row: Row) {
    setBusy(row.key); setNotice(null)
    const result = await saveCompetitor(fetch, clientId, row.id,
      { name: row.name, aliases: splitList(row.aliases), domains: splitList(row.domains) },
      row.legacyName ? { legacyName: row.legacyName } : {})
    setBusy(null)
    if (!result.ok) return fail(result.error)
    update(row.key, { ...toRow(result.competitor, 0), key: row.key })
    setNotice({ kind: 'status', text: t('saved') })
  }

  async function remove(row: Row) {
    setBusy(row.key); setNotice(null)
    const result = await removeCompetitor(fetch, clientId, row.id, row.legacyName ?? undefined)
    setBusy(null)
    if (!result.ok) return fail(result.error)
    setRows(current => current.filter(r => r.key !== row.key))
    setNotice({ kind: 'status', text: t('removed') })
  }

  async function add(event: React.FormEvent) {
    event.preventDefault()
    setBusy('new'); setNotice(null)
    const result = await saveCompetitor(fetch, clientId, null,
      { name: draft.name, aliases: splitList(draft.aliases), domains: splitList(draft.domains) })
    setBusy(null)
    if (!result.ok) return fail(result.error)
    setRows(current => [...current, toRow(result.competitor, current.length)])
    setDraft({ name: '', aliases: '', domains: '' })
    setNotice({ kind: 'status', text: t('added') })
  }

  const atLimit = rows.length >= max

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted-foreground">{t('intro')}</p>
      <p className="text-xs font-medium text-muted-foreground">{t('count', { count: rows.length, max })}</p>

      <div aria-live="polite">
        {notice?.kind === 'status' && <p role="status" className="text-sm text-primary-accessible">{notice.text}</p>}
        {notice?.kind === 'alert' && <p role="alert" className="text-sm text-destructive">{notice.text}</p>}
      </div>

      {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('empty')}</p>}

      {rows.map(row => {
        const id = `${formId}-${row.key}`
        const label = row.name || row.legacyName || ''
        return (
          <Card key={row.key}>
            <CardContent className="p-4">
              <fieldset className="grid gap-3" disabled={busy === row.key}>
                <legend className="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {label}
                  {row.legacyName && <Badge variant="secondary" className="font-normal">{t('legacy_badge')}</Badge>}
                </legend>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-name`}>{t('name_label')}</Label>
                  <Input id={`${id}-name`} value={row.name} maxLength={120} className="min-h-11"
                    onChange={e => update(row.key, { name: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-aliases`}>{t('aliases_label')}</Label>
                  <Input id={`${id}-aliases`} value={row.aliases} aria-describedby={`${id}-aliases-hint`} className="min-h-11"
                    onChange={e => update(row.key, { aliases: e.target.value })} />
                  <p id={`${id}-aliases-hint`} className="text-xs text-muted-foreground">{t('aliases_hint')}</p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-domains`}>{t('domains_label')}</Label>
                  <Input id={`${id}-domains`} value={row.domains} aria-describedby={`${id}-domains-hint`} className="min-h-11"
                    inputMode="url" autoCapitalize="none" spellCheck={false}
                    onChange={e => update(row.key, { domains: e.target.value })} />
                  <p id={`${id}-domains-hint`} className="text-xs text-muted-foreground">{t('domains_hint')}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" className="min-h-11" aria-label={t('save_label', { name: label })} onClick={() => save(row)}>
                    {busy === row.key ? t('saving') : t('save')}
                  </Button>
                  <Button type="button" variant="outline" className="min-h-11" aria-label={t('remove_label', { name: label })} onClick={() => remove(row)}>
                    {t('remove')}
                  </Button>
                </div>
              </fieldset>
            </CardContent>
          </Card>
        )
      })}

      <Card>
        <CardContent className="p-4">
          <form onSubmit={add} aria-labelledby={`${formId}-add-title`}>
            <fieldset className="grid gap-3" disabled={busy === 'new' || atLimit}>
              <legend id={`${formId}-add-title`} className="mb-1 text-sm font-semibold">{t('add_title')}</legend>
              <div className="grid gap-1.5">
                <Label htmlFor={`${formId}-new-name`}>{t('name_label')}</Label>
                <Input id={`${formId}-new-name`} value={draft.name} maxLength={120} required className="min-h-11"
                  onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${formId}-new-aliases`}>{t('aliases_label')}</Label>
                <Input id={`${formId}-new-aliases`} value={draft.aliases} aria-describedby={`${formId}-new-aliases-hint`} className="min-h-11"
                  onChange={e => setDraft(d => ({ ...d, aliases: e.target.value }))} />
                <p id={`${formId}-new-aliases-hint`} className="text-xs text-muted-foreground">{t('aliases_hint')}</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${formId}-new-domains`}>{t('domains_label')}</Label>
                <Input id={`${formId}-new-domains`} value={draft.domains} aria-describedby={`${formId}-new-domains-hint`} className="min-h-11"
                  inputMode="url" autoCapitalize="none" spellCheck={false}
                  onChange={e => setDraft(d => ({ ...d, domains: e.target.value }))} />
                <p id={`${formId}-new-domains-hint`} className="text-xs text-muted-foreground">{t('domains_hint')}</p>
              </div>
              {atLimit && <p className="text-xs text-muted-foreground">{t('err_limit', { max })}</p>}
              <div><Button type="submit" className="min-h-11">{busy === 'new' ? t('saving') : t('add')}</Button></div>
            </fieldset>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
