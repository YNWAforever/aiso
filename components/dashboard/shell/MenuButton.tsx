'use client'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A disclosure menu for the top bar: one button, one panel of links. Closes on
 * Escape (focus back on the button), on an outside click and on choosing a
 * link. The same pattern as NotificationBell, kept small on purpose: no
 * dropdown library for a list of links.
 */
export function MenuButton({ label, button, children, align = 'start', className }: {
  /** Accessible name for the button. */
  label: string
  /** The button's visible content. */
  button: ReactNode
  /** Panel content; receives a close callback for links to call. */
  children: (close: () => void) => ReactNode
  align?: 'start' | 'end'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
  }, [open])

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(value => !value)}
        className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {button}
      </button>
      <div
        id={panelId}
        hidden={!open}
        className={cn('absolute top-full z-50 mt-1 w-64 rounded-xl border border-border bg-card p-1.5 shadow-e3', align === 'end' ? 'right-0' : 'left-0')}
      >
        {children(() => setOpen(false))}
      </div>
    </div>
  )
}
