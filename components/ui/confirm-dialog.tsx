'use client'
import { useState, type RefObject } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  /** Defaults to "Confirm". */
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  /** May be async; the dialog stays open and busy until it settles, and closes only on success. */
  onConfirm: () => void | Promise<void>
  /** Where focus goes when the dialog closes, when the element that opened it (e.g. a menu item) is gone. */
  returnFocusRef?: RefObject<HTMLElement | null>
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, cancelLabel, destructive, onConfirm, returnFocusRef }: ConfirmDialogProps) {
  const t = useTranslations('ui')
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next) }}>
      <DialogContent hideClose role="alertdialog" onCloseAutoFocus={event => { const target = returnFocusRef?.current; if (target && target.isConnected) { event.preventDefault(); target.focus() } }}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{cancelLabel ?? t('cancel')}</Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={confirm} disabled={busy} aria-busy={busy}>
            {confirmLabel ?? t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
