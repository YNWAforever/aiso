'use client'

import { useTranslations } from 'next-intl'
import { useOptionalStudioSession } from '@/components/dashboard/StudioSession'

/**
 * The undo for the last archive. Archived discussions leave every list, so this is the
 * only place a person can bring one back; it stays until dismissed or undone.
 */
export function StudioArchiveUndo() {
  const t = useTranslations('conversationStudio.threadActions')
  const session = useOptionalStudioSession()
  const undo = session?.archivedUndo
  return <div role="status" aria-live="polite" aria-atomic="true">
    {undo && <div className="as-note flex flex-wrap items-center gap-3">
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{t(undo.failed ? 'undoFailed' : 'archivedNotice', { title: undo.title })}</span>
      <button type="button" className="as-button px-3 font-semibold" onClick={() => void session!.undoArchive()}>{t('undo')}</button>
      <button type="button" className="as-button px-3" onClick={session!.dismissArchivedUndo}>{t('dismiss')}</button>
    </div>}
  </div>
}
