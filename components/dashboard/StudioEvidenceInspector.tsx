import * as Dialog from '@radix-ui/react-dialog'
import { useTranslations } from 'next-intl'
import { useRef } from 'react'
import { StudioSavedEvidence } from '@/components/dashboard/StudioReply'
import { StudioLiveEvidence } from '@/components/dashboard/StudioLiveReply'
import type { StudioEvidence, StudioEvidenceTarget, StudioInspectorReads, StudioReply } from '@/lib/conversation-studio/types'
import type { StudioLiveReply } from '@/lib/conversation-studio/live-types'
import type { StudioSourceStatus } from '@/lib/conversation-studio/home'

export function StudioEvidenceRows({ reads, sourceStatus }: { reads: StudioInspectorReads; sourceStatus: StudioSourceStatus }) {
  const t = useTranslations('conversationStudio')
  const sync = reads.searchConsole
  return <div className="as-evidence-rows">
    <section className="space-y-2">
      <h3>{t('evidence.brandDocuments')}</h3>
      <p className="as-muted">{t('evidence.documentsReadOnly')}</p>
      {reads.documents === null ? <p>{t('honesty.pending')}</p> : <>
        {!reads.documents.items.length && <p>{t('evidence.unknown')}</p>}
        <ul className="space-y-3">{reads.documents.items.map(item => <li key={item.versionId} className="space-y-1">
          <p className="font-semibold">{item.label}</p>
          <p>{t('evidence.approvedVersion', { version: item.versionNumber })}</p>
          <p>{t('evidence.approvedAt')}: <time dateTime={item.approvedAt}>{item.approvedAt}</time></p>
          <p>{t('evidence.importedAt')}: <time dateTime={item.importedAt}>{item.importedAt}</time></p>
          <p>{t('evidence.versionId')}: {item.versionId}</p>
        </li>)}</ul>
        {reads.documents.truncated && <p className="as-note">{t('evidence.documentsTruncated')}</p>}
      </>}
    </section>
    <section className="space-y-2">
      <h3>{t('evidence.searchConsole')}</h3>
      <p>{t(`sources.${sourceStatus}`)}</p>
      <p>{t('evidence.syncStatus')}: {sync ? t(`evidence.sync.${sync.kind}`) : t('honesty.pending')}</p>
      {sync && 'dataThrough' in sync && sync.dataThrough && <p>{t('evidence.dataThrough')}: <time dateTime={sync.dataThrough}>{sync.dataThrough}</time></p>}
      <p className="as-badge as-badge-amber">{t('evidence.notQueried')}</p>
    </section>
    <section className="space-y-2"><h3>{t('evidence.dataForSeo')}</h3><p>{t('connections.disconnected')}</p></section>
    <section className="space-y-2"><h3>{t('evidence.firecrawl')}</h3><p>{t('connections.disconnected')}</p></section>
  </div>
}

/** In-flow aside, using the existing dialog primitive for focus containment and Escape. */
export function StudioEvidenceInspector({ reply, evidence, liveReply, liveEnabled, reads, sourceStatus, prompt, target, trigger, onClose }: {
  reply: StudioReply; evidence: StudioEvidence; liveReply?: StudioLiveReply; liveEnabled: boolean
  reads: StudioInspectorReads; sourceStatus: StudioSourceStatus; prompt: string
  target: StudioEvidenceTarget; trigger: HTMLButtonElement; onClose: () => void
}) {
  const t = useTranslations('conversationStudio')
  const content = useRef<HTMLDivElement>(null)
  const id = 'studio-inspected'
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
    <aside className="as-inspector" aria-label={t('evidence.inspectorLabel')}>
    <Dialog.Content ref={content} id="studio-evidence-inspector" className="as-inspector-body" onOpenAutoFocus={event => {
      event.preventDefault()
      const source = target === 'saved' ? null : document.getElementById(`${id}-${target}`)
      ;(source ?? content.current?.querySelector<HTMLButtonElement>('button'))?.focus()
    }} onCloseAutoFocus={event => { event.preventDefault(); if (trigger.isConnected) trigger.focus() }}>

        <header className="as-inspector-header">
          <Dialog.Title asChild><h2>{t('evidence.panelTitle')}</h2></Dialog.Title>
          <Dialog.Close asChild><button type="button" className="as-button px-3">{t('evidence.close')}</button></Dialog.Close>
        </header>
        <Dialog.Description asChild><p className="as-muted">{t('evidence.turnScope')}</p></Dialog.Description>
        <p className="as-evidence-prompt">{prompt}</p>
        <StudioEvidenceRows reads={reads} sourceStatus={sourceStatus} />
        <section className="as-evidence-citations space-y-3">
          <h3>{t('evidence.aiCitations')}</h3>
          <p className="as-muted">{t('evidence.aiCitationScope')}</p>
          <StudioSavedEvidence reply={reply} evidence={evidence} id={id} liveEnabled={liveEnabled} />
          {liveEnabled && <StudioLiveEvidence reply={liveReply} id={id} />}
        </section>
        <footer className="as-note">{t('honesty.noEstimatedNumbers')}</footer>
    </Dialog.Content>
    </aside>
  </Dialog.Root>
}
