'use client'
import { useState, useEffect, useRef, useId } from 'react'
import { useRouter } from 'next/navigation'
import type { Notification } from '@/lib/types'

const COPY = {
  en: { title: 'Notifications', unknown: 'Unread count unavailable', empty: 'No notifications yet.', loading: 'Loading…', failed: 'Notifications could not be loaded.', retry: 'Retry', mark: 'Mark all read', writeFailed: 'Notifications could not be marked as read.' },
  'zh-HK': { title: '通知', unknown: '未讀數量暫時無法取得', empty: '暫時沒有通知。', loading: '載入中…', failed: '暫時無法載入通知。', retry: '重試', mark: '全部標為已讀', writeFailed: '暫時無法將通知標為已讀。' },
}
const TYPE_ICON: Record<string, string> = { sov_threshold: '📉', sov_wow_drop: '⚠️', sov_recovery: '✅' }

export function NotificationBell({ initialCount, lang = 'en' }: { initialCount: number | null; lang?: string }) {
  const copy = lang === 'zh-HK' ? COPY['zh-HK'] : COPY.en
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(initialCount)
  const [notifications, setNotifs] = useState<Notification[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [writeError, setWriteError] = useState(false)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const router = useRouter()

  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && ref.current?.contains(document.activeElement)) {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [])

  const loadNotifications = async () => {
    if (loaded || loading) return
    setLoading(true)
    setLoadError(false)
    try {
      const response = await fetch('/api/notifications')
      if (!response.ok) throw new Error('Notification lookup failed')
      const data = await response.json()
      if (!Array.isArray(data.notifications) || !data.notifications.every((item: Notification) => item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.message === 'string' && typeof item.read === 'boolean' && typeof item.created_at === 'string')) throw new Error('Invalid notification response')
      setNotifs(data.notifications)
      setLoaded(true)
      // This endpoint returns only the latest 20; refresh the authoritative server count.
      if (count === null) router.refresh()
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  const handleOpen = async () => {
    setOpen(!open)
    if (!open) await loadNotifications()
  }
  const markAllRead = async () => {
    if (saving || loading) return
    setSaving(true)
    setWriteError(false)
    try {
      const response = await fetch('/api/notifications/read-all', { method: 'PUT' })
      if (!response.ok) throw new Error('Notification update failed')
      setNotifs(items => items.map(item => ({ ...item, read: true })))
      setCount(0)
      router.refresh()
    } catch {
      setWriteError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button ref={trigger} type="button" onClick={handleOpen} className="relative min-h-11 min-w-11 inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition" aria-label={count === null ? `${copy.title}: ${copy.unknown}` : copy.title} aria-expanded={open} aria-controls={panelId}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
        {count !== null && count > 0 && <span className="absolute top-0 right-0 bg-destructive text-destructive-foreground text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">{count > 9 ? '9+' : count}</span>}
        {count === null && <span aria-hidden="true" className="absolute top-0 right-0 text-xs">?</span>}
      </button>
      {open && (
        <section id={panelId} aria-label={copy.title} className="absolute right-0 top-12 w-80 max-w-[calc(100vw-3rem)] bg-popover rounded-xl border border-border shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
            <h2 className="text-sm font-bold text-popover-foreground">{copy.title}</h2>
            {((count ?? 0) > 0 || notifications.some(item => !item.read)) && <button type="button" onClick={markAllRead} disabled={saving || loading} className="min-h-11 text-xs text-primary-accessible disabled:opacity-60">{copy.mark}</button>}
          </div>
          {count === null && <p className="px-4 pt-3 text-xs text-muted-foreground">{copy.unknown}</p>}
          {loadError ? <div className="px-4 py-4"><p role="status" className="text-sm text-muted-foreground">{copy.failed}</p><button type="button" onClick={loadNotifications} className="min-h-11 text-sm text-primary-accessible">{copy.retry}</button></div> : !loaded ? <p role="status" className="px-4 py-8 text-center text-sm text-muted-foreground">{copy.loading}</p> : notifications.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">{copy.empty}</p> : (
            <div className="max-h-80 overflow-y-auto divide-y divide-border">
              {notifications.map(item => <div key={item.id} className={`px-4 py-3 flex gap-3 ${!item.read ? 'bg-primary/10' : ''}`}><span aria-hidden="true" className="text-base mt-0.5 shrink-0">{TYPE_ICON[item.type] ?? '🔔'}</span><div className="flex-1 min-w-0"><p className="text-xs font-semibold text-popover-foreground">{item.title}</p><p className="text-xs text-muted-foreground mt-0.5">{item.message}</p><p className="text-xs text-muted-foreground mt-1">{new Date(item.created_at).toLocaleDateString(lang === 'zh-HK' ? 'zh-HK' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p></div></div>)}
            </div>
          )}
          {writeError && <p role="status" className="px-4 py-3 text-sm text-destructive">{copy.writeFailed}</p>}
        </section>
      )}
    </div>
  )
}
