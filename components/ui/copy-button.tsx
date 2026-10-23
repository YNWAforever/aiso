'use client'
import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

export interface CopyButtonProps {
  /** The text that lands on the clipboard. */
  value: string
  /** Visible label; defaults to "Copy". */
  label?: string
  /** Names what is copied for screen readers, e.g. "Copy: llms.txt". */
  accessibleLabel?: string
  copiedLabel?: string
  className?: string
  onCopied?: () => void
}

/**
 * One copy affordance everywhere: the icon turns into a check that pops in,
 * the label reads "Copied" for two seconds, and a status line says it (or
 * that copying failed) once to screen readers. Transform and opacity only;
 * with reduced motion the icon simply swaps.
 */
export function CopyButton({ value, label, accessibleLabel, copiedLabel, className, onCopied }: CopyButtonProps) {
  const t = useTranslations('ui')
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
      onCopied?.()
    } catch {
      setState('failed')
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2000)
  }

  const copied = state === 'copied'
  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={accessibleLabel}
        className={cn(
          'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition-[background-color,transform] duration-150 ease-standard hover:bg-muted active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:active:scale-100',
          className,
        )}
      >
        <span className="relative inline-flex size-4" aria-hidden="true">
          <Copy className={cn('absolute size-4 transition-[opacity,transform] duration-150 ease-standard motion-reduce:transition-none', copied ? 'scale-50 opacity-0' : 'scale-100 opacity-100')} />
          <Check className={cn('absolute size-4 text-tone-success-fg transition-[opacity,transform] duration-150 ease-standard motion-reduce:transition-none', copied ? 'scale-100 opacity-100' : 'scale-50 opacity-0')} />
        </span>
        {copied ? copiedLabel ?? t('copied') : label ?? t('copy')}
      </button>
      {/* Visible when copying failed, so the reader knows to copy by hand. */}
      <span role="status" className={state === 'failed' ? 'text-xs text-tone-danger-fg' : 'sr-only'}>
        {copied ? copiedLabel ?? t('copied') : state === 'failed' ? t('copy_failed') : ''}
      </span>
    </>
  )
}
