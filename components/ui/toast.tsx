'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { DURATION, exitTransition, transition, variants } from '@/lib/motion'
import { MotionRoot } from '@/components/visuals/MotionRoot'

export type ToastTone = 'success' | 'info' | 'warning' | 'danger'

export interface ToastInput {
  title: string
  description?: string
  tone?: ToastTone
  /** Milliseconds; 0 keeps it until dismissed. */
  duration?: number
}

interface ToastItem extends ToastInput { id: number }

const ToastContext = createContext<{ toast: (input: ToastInput) => void } | null>(null)

const ICONS = { success: CheckCircle2, info: Info, warning: TriangleAlert, danger: XCircle } as const
const ICON_TONE = { success: 'text-tone-success-fg', info: 'text-tone-info-fg', warning: 'text-tone-warning-fg', danger: 'text-tone-danger-fg' } as const

/** `toast()` anywhere under <ToastProvider>. Outside one it is a no-op rather than a crash. */
export function useToast() {
  return useContext(ToastContext) ?? { toast: () => {} }
}

/**
 * Toasts slide up on phones (bottom of the screen) and in at the top right on
 * wide screens. The list is a polite live region, so each new toast is read once.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(0)
  const dismiss = useCallback((id: number) => setItems(list => list.filter(item => item.id !== id)), [])
  const toast = useCallback((input: ToastInput) => {
    const id = ++nextId.current
    setItems(list => [...list.slice(-2), { ...input, id }])
  }, [])
  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <MotionRoot>
        <ol
          aria-live="polite"
          className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col gap-2 sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:w-96"
        >
          <AnimatePresence initial={false}>
            {items.map(item => <ToastRow key={item.id} item={item} onDismiss={dismiss} />)}
          </AnimatePresence>
        </ol>
      </MotionRoot>
    </ToastContext.Provider>
  )
}

function ToastRow({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const t = useTranslations('ui')
  const tone = item.tone ?? 'info'
  const Icon = ICONS[tone]
  const duration = item.duration ?? 5000

  useEffect(() => {
    if (!duration) return
    const timer = setTimeout(() => onDismiss(item.id), duration)
    return () => clearTimeout(timer)
  }, [duration, item.id, onDismiss])

  return (
    <m.li
      variants={variants.toast}
      initial="hidden"
      animate="visible"
      exit={{ ...variants.toast.exit, transition: exitTransition(DURATION.enter) }}
      transition={transition(DURATION.enter)}
      className="pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-e2"
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-5 shrink-0', ICON_TONE[tone])} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-semibold text-foreground">{item.title}</p>
        {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
      </div>
      <button type="button" onClick={() => onDismiss(item.id)} className="rounded-md p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <X aria-hidden="true" className="size-4" />
        <span className="sr-only">{t('dismiss')}</span>
      </button>
    </m.li>
  )
}
