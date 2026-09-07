'use client'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { VersionDetail } from '@/lib/change-sets/types'
import type { AttestInput, DeliveryEvent, DeliveryPage } from '@/lib/delivery/types'
import { deliveryId, deliveryText } from '@/lib/delivery/input'
import { deliveryEventDTO } from '@/lib/delivery/dto'
import { DeliveryForm, type DeliveryFields } from './DeliveryForm'
import { DeliveryHistory } from './DeliveryHistory'
const emptyFields: DeliveryFields = { destination: '', deliveredAt: '', note: '' }
function eventDTO(value: unknown, version: VersionDetail): DeliveryEvent {
  if (!value || typeof value !== 'object') throw Error()
  const e = value as DeliveryEvent
  const result = deliveryEventDTO({ schema_version: e.schemaVersion, id: e.eventId, version_id: e.versionId, content_hash: e.contentHash,
    actor_id: e.actor?.profileId, actor: e.actor, recorded_at: e.recordedAt, kind: e.kind,
    destination: e.kind === 'attest' ? e.destination : null, delivered_at: e.kind === 'attest' ? e.deliveredAt : null,
    note: e.kind === 'attest' ? e.note : null, target_attestation_id: e.kind === 'withdraw' ? e.targetAttestationId : null,
    reason: e.kind === 'withdraw' ? e.reason : null })
  if (result.versionId !== version.id || result.contentHash !== version.contentHash) throw Error()
  return result
}
function pageDTO(value: unknown, version: VersionDetail): DeliveryPage {
  const p = value as DeliveryPage
  if (!p || !Array.isArray(p.events) || !p.capabilities || (p.nextCursor !== null && typeof p.nextCursor !== 'string')) throw Error()
  const c = p.capabilities, reasons = [null, 'not_approved', 'superseded', 'active_attestation', 'no_active_attestation']
  if ([c.canExport, c.canAttest, c.canWithdraw].some(v => typeof v !== 'boolean') || !reasons.includes(c.attestReason) || !reasons.includes(c.withdrawReason)) throw Error()
  const activeAttestationId = p.activeAttestationId === null ? null : deliveryId(p.activeAttestationId)
  if (c.canAttest !== (c.attestReason === null) || c.canWithdraw !== (activeAttestationId !== null) || c.canWithdraw !== (c.withdrawReason === null) || (c.canAttest && (!c.canExport || activeAttestationId))) throw Error()
  return { events: p.events.map(e => eventDTO(e, version)), activeAttestationId, nextCursor: p.nextCursor, capabilities: { ...c } }
}
function responseError(status: number) {
  return status === 401 ? 'unauthenticated' : status === 403 ? 'denied' : status === 409 ? 'conflict' : status === 400 || status === 413 || status === 422 ? 'invalid' : 'unavailable'
}
export function DeliveryWorkspace({ clientId, version, onDirtyChange, onDeliveryChange }: { clientId: string; version: VersionDetail; onDirtyChange: (dirty: boolean) => void; onDeliveryChange?: () => void }) {
  const t = useTranslations('delivery'), id = useId()
  const [page, setPage] = useState<DeliveryPage | null>(null), [authority, setAuthority] = useState(false)
  const [authorityVersion, setAuthorityVersion] = useState<VersionDetail | null>(null)
  const authorized = authority && authorityVersion === version
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('')
  const [fields, setFields] = useState<DeliveryFields>(emptyFields), [target, setTarget] = useState<string | null>(null), [reason, setReason] = useState('')
  const generation = useRef(0), lock = useRef(false), dirty = useRef(false), alive = useRef(true)
  const operation = useRef<{ payload: string; requestId: string } | null>(null), statusRef = useRef<HTMLParagraphElement>(null), reasonRef = useRef<HTMLTextAreaElement>(null)
  const base = `/api/clients/${encodeURIComponent(clientId)}/work-items/${encodeURIComponent(version.workItemId)}/versions/${encodeURIComponent(version.id)}`
  const endpoint = base + '/delivery'
  const markDirty = useCallback((next: boolean) => { dirty.current = next; onDirtyChange(next) }, [onDirtyChange])
  const load = useCallback(async (cursor: string | null = null) => {
    const token = ++generation.current
    setLoading(true); setAuthority(false); setError('')
    try {
      const res = await fetch(endpoint + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), { cache: 'no-store' })
      if (!res.ok) throw Error(responseError(res.status))
      const next = pageDTO(await res.json(), version)
      if (!alive.current || token !== generation.current) return
      setPage(previous => cursor && previous ? { ...next, events: [...previous.events, ...next.events].filter((e, i, all) => all.findIndex(x => x.eventId === e.eventId) === i) } : next)
      setAuthorityVersion(version); setAuthority(true)
    } catch (failure) {
      if (alive.current && token === generation.current) { setAuthority(false); setError(failure instanceof Error && ['unauthenticated', 'denied', 'conflict', 'invalid'].includes(failure.message) ? failure.message : 'unavailable') }
    } finally { if (alive.current && token === generation.current) setLoading(false) }
  }, [endpoint, version])
  useEffect(() => {
    alive.current = true
    const requests = generation
    const start = setTimeout(() => { void load() }, 0)
    return () => { clearTimeout(start); alive.current = false; requests.current++ }
  }, [load])
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = '' } }
    const navigate = (event: MouseEvent) => {
      if (dirty.current && (event.target as Element).closest('a[href]:not([download])') && !window.confirm(t('discardConfirm'))) { event.preventDefault(); event.stopPropagation() }
    }
    window.addEventListener('beforeunload', unload); document.addEventListener('click', navigate, true)
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigate, true) }
  }, [t])
  function changed(next: DeliveryFields) { setFields(next); markDirty(Boolean(next.destination || next.deliveredAt || next.note || reason || target)) }
  async function mutate(kind: 'attest' | 'withdraw', value: Omit<AttestInput, 'requestId'> | { reason: string }) {
    if (lock.current || !authorized || !(kind === 'attest' ? page?.capabilities.canAttest : page?.capabilities.canWithdraw)) return
    const path = kind === 'attest' ? endpoint : endpoint + '/' + encodeURIComponent(target!) + '/withdraw'
    const payload = JSON.stringify({ path, ...value })
    if (operation.current?.payload !== payload) operation.current = { payload, requestId: crypto.randomUUID() }
    lock.current = true; generation.current++; setBusy(true); setLoading(false); setError(''); setStatus('')
    try {
      const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...value, requestId: operation.current.requestId }) })
      if (!res.ok) throw Error(responseError(res.status))
      const event = eventDTO((await res.json()).event, version)
      if (event.kind !== kind || (event.kind === 'withdraw' && event.targetAttestationId !== target)) throw Error()
      if (!alive.current) return
      generation.current++; operation.current = null
      onDeliveryChange?.()
      if (kind === 'attest') { setFields(emptyFields); markDirty(Boolean(target || reason)) }
      else { setReason(''); setTarget(null); markDirty(Boolean(fields.destination || fields.deliveredAt || fields.note)) }
      setPage(previous => previous ? { ...previous, events: [event, ...previous.events.filter(e => e.eventId !== event.eventId)], activeAttestationId: event.kind === 'attest' ? event.eventId : null } : previous)
      setStatus(kind === 'attest' ? 'recorded' : 'withdrawalRecorded'); setAuthority(false)
      await load()
      requestAnimationFrame(() => statusRef.current?.focus())
    } catch (failure) {
      if (alive.current) { setAuthority(false); setError(failure instanceof Error && ['unauthenticated', 'denied', 'conflict', 'invalid'].includes(failure.message) ? failure.message : 'unavailable'); if (kind === 'withdraw') reasonRef.current?.focus() }
    } finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  async function download(format: 'json' | 'text') {
    if (lock.current || !authorized || !page?.capabilities.canExport) return
    lock.current = true; setBusy(true); setError('')
    try {
      const res = await fetch(base + '/export?format=' + format, { cache: 'no-store' })
      if (!res.ok) throw Error(responseError(res.status))
      const filename = `delivery-${deliveryId(version.id)}.${format === 'json' ? 'json' : 'txt'}`
      if (res.headers.get('Content-Disposition') !== `attachment; filename="${filename}"` || !/^[a-f0-9]{64}$/.test(res.headers.get('X-Aiso-Export-Sha256') ?? '') || !res.headers.get('Content-Type')?.startsWith(format === 'json' ? 'application/json' : 'text/plain')) throw Error()
      const url = URL.createObjectURL(await res.blob()), anchor = document.createElement('a')
      anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
      setStatus('downloaded')
    } catch (failure) {
      setAuthority(false); setError(failure instanceof Error && ['unauthenticated', 'denied', 'conflict', 'invalid'].includes(failure.message) ? failure.message : 'unavailable')
    } finally { lock.current = false; setBusy(false) }
  }
  const button = 'min-h-11 rounded border border-border px-4 py-2 font-semibold disabled:opacity-50'
  return <section className="space-y-4 rounded-xl border border-border p-4" aria-label={t('title')} aria-busy={loading || busy}>
    <h2 className="text-xl font-semibold">{t('title')}</h2>
    <p>{t('limitation')}</p><p>{t('versionBound', { number: version.versionNumber })}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={busy || !authorized || !page?.capabilities.canExport} onClick={() => download('json')}>{t('exportJson')}</button>
      <button type="button" className={button} disabled={busy || !authorized || !page?.capabilities.canExport} onClick={() => download('text')}>{t('exportText')}</button>
      <button type="button" className={button} disabled={busy || loading} onClick={() => load()}>{t('refresh')}</button>
    </div>
    {error && <p role="alert">{t(error)}</p>}
    {(loading || status) && <p role={status ? "status" : undefined} aria-live="polite" tabIndex={-1} ref={statusRef}>{loading ? t('loading') : t(status)}</p>}
    {!authorized && !loading && <p>{t('refreshRequired')}</p>}
    {authorized && page?.capabilities.attestReason && <p>{t(page.capabilities.attestReason)}</p>}
    <DeliveryForm version={version} values={fields} busy={busy} canAttest={authorized && Boolean(page?.capabilities.canAttest)} onChange={changed} onSubmit={value => { void mutate('attest', value) }} />
    {page && <DeliveryHistory events={page.events} activeAttestationId={page.activeAttestationId} nextCursor={page.nextCursor} busy={busy || loading} canWithdraw={authorized && page.capabilities.canWithdraw} onMore={() => load(page.nextCursor)} onWithdraw={value => { setTarget(value); markDirty(true); requestAnimationFrame(() => reasonRef.current?.focus()) }} />}
    {target && <form className="space-y-3" onSubmit={event => { event.preventDefault(); try { void mutate('withdraw', { reason: deliveryText(reason, 2000, true) }) } catch { setError('invalid'); reasonRef.current?.focus() } }}>
      <p>{t('withdrawConfirm')}</p>
      <label className="block" htmlFor={id + 'withdraw'}>{t('withdrawReason')}</label>
      <textarea id={id + 'withdraw'} ref={reasonRef} required rows={3} className="w-full rounded border border-border bg-background p-3" value={reason} readOnly={busy} onChange={e => { setReason(e.target.value); markDirty(true) }} />
      <button type="submit" className={button} disabled={busy || !authorized || !page?.capabilities.canWithdraw}>{t('confirmWithdraw')}</button>
    </form>}
    {(fields.destination || fields.deliveredAt || fields.note || target) && <button type="button" className={button} disabled={busy} onClick={() => { if (window.confirm(t('discardConfirm'))) { setFields(emptyFields); setReason(''); setTarget(null); operation.current = null; markDirty(false) } }}>{t('discard')}</button>}
  </section>
}
