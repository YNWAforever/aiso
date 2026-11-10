'use client'

import { useTranslations } from 'next-intl'
import { describeAttachedSource } from '@/lib/conversation-studio/attachment-view'
import type { StudioAttachMeta } from '@/lib/conversation-studio/live-types'
import type { StudioInspectorReads } from '@/lib/conversation-studio/types'

/**
 * Which source version a turn used, or the honest statement that the saved path
 * recorded an attachment without reading it. A newer approved version is flagged;
 * nothing is silently re-run or swapped.
 */
export function StudioAttachedSource({ attached, liveAttachment, documents }: {
  attached?: { label: string; versionNumber: number } | null
  liveAttachment?: StudioAttachMeta | null
  documents: StudioInspectorReads['documents'] | undefined
}) {
  const t = useTranslations('conversationStudio')
  const view = describeAttachedSource({ attached, liveAttachment, documents })
  if (!view) return null
  const hash = view.contentHash ? view.contentHash.slice(0, 8) : null
  return <section className="as-note space-y-1" aria-label={t('attach.attachedSource.title')}>
    <p className="as-small font-semibold">{t('attach.attachedSource.title')}: {view.label}</p>
    <p className="as-muted as-small">
      {view.kind === 'live'
        ? t('attach.attachedSource.liveRead', { version: view.usedVersionNumber ?? t('attach.attachedSource.unknownVersion') })
        : t('attach.attachedSource.savedNotRead')}
      {view.usedVersionNumber !== null && view.kind === 'recorded' && ` ${t('attach.attachedSource.recordedVersion', { version: view.usedVersionNumber })}`}
      {view.entriesTotal !== null && view.entriesIncluded !== null && ` ${t('attach.attachedSource.entries', { included: view.entriesIncluded, total: view.entriesTotal })}`}
      {view.truncated && ` ${t('attach.attachedSource.truncated')}`}
      {hash && <> <code>{hash}</code></>}
    </p>
    {view.stale && view.currentVersionNumber !== null && <p role="status" className="as-small">{t('attach.attachedSource.newerVersion', { version: view.currentVersionNumber })}</p>}
  </section>
}
