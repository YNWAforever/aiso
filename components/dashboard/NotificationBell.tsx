'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { Notification } from '@/lib/types'

const TYPE_ICON: Record<string, string> = {
  sov_threshold: '📉',
  sov_wow_drop:  '⚠️',
  sov_recovery:  '✅',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function NotificationBell({ initialCount }: { initialCount: number }) {
  const [open, setOpen]            = useState(false)
  const [count, setCount]          = useState(initialCount)
  const [notifications, setNotifs] = useState<Notification[]>([])
  const [loaded, setLoaded]        = useState(false)
  const ref    = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const loadNotifications = async () => {
    if (loaded) return
    const { notifications: data } = await fetch('/api/notifications').then(r => r.json())
    setNotifs(data ?? []); setLoaded(true)
  }

  const handleOpen = async () => {
    const next = !open; setOpen(next)
    if (next) await loadNotifications()
  }

  const markAllRead = async () => {
    await fetch('/api/notifications/read-all', { method: 'PUT' })
    setNotifs(n => n.map(x => ({ ...x, read: true })))
    setCount(0)
    // Re-render the layout so its server-computed unread count is also cleared
    router.refresh()
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={handleOpen} className="relative p-1 text-muted-foreground hover:text-foreground transition" aria-label="Notifications">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-9 w-80 bg-popover rounded-xl border border-border shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-bold text-popover-foreground">Notifications</span>
            {count > 0 && (
              <button onClick={markAllRead} className="text-xs text-primary hover:text-primary-accessible">Mark all read</button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">{loaded ? 'No notifications yet.' : 'Loading…'}</div>
          ) : (
            <div className="max-h-80 overflow-y-auto divide-y divide-border">
              {notifications.map(n => (
                <div key={n.id} className={`px-4 py-3 flex gap-3 ${!n.read ? 'bg-primary/10' : 'opacity-60'}`}>
                  <span className="text-base mt-0.5 flex-shrink-0">{TYPE_ICON[n.type] ?? '🔔'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-popover-foreground truncate">{n.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{formatDate(n.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
