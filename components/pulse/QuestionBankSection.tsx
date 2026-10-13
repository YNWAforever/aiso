// components/pulse/QuestionBankSection.tsx
'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Sparkles } from 'lucide-react'
import { PromptBankEditor } from './PromptBankEditor'
import { SuggestQuestionsPanel } from './SuggestQuestionsPanel'
import type { PromptBankItem } from '@/lib/types'
import type { PromptContextDefaults } from '@/lib/prompts/context'

interface Props {
  clientId: string
  contextDefaults?: PromptContextDefaults
  initialPrompts: PromptBankItem[]
  isFirstTime: boolean   // true when prompt bank was just auto-generated
}

export function QuestionBankSection({ clientId, initialPrompts, isFirstTime, contextDefaults }: Props) {
  const t = useTranslations('pulse')
  const [showPanel, setShowPanel] = useState(false)
  // The single owner of the list. PromptBankEditor is controlled from here, so
  // a suggestion accepted in the panel and a question added in the editor land
  // in the same array — they used to be two, and only one of them rendered.
  const [prompts, setPrompts] = useState<PromptBankItem[]>(initialPrompts)
  const [error, setError] = useState<string | null>(null)
  // Only a reload from the server reconciles a write whose acknowledgement was lost.
  const [hasUnresolvedSave, setHasUnresolvedSave] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  const activeCount = prompts.filter(p => p.is_active).length

  // Takes the row the server created, so the new question is immediately
  // editable and deletable like any other. It used to fabricate a `temp-` id
  // that matched no row, so the first edit of it would 404.
  function handleAccepted(prompt: PromptBankItem) {
    setPrompts(prev => prev.some(row => row.id === prompt.id) ? prev : [...prev, prompt])
    setError(null)
  }

  return (
    <div id="question-bank" className="relative">
      {/* First-time banner */}
      {isFirstTime && !bannerDismissed && (
        <div className="flex items-center justify-between bg-primary/10 border border-primary/20 rounded-xl px-4 py-3 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <Sparkles className="size-4 text-primary shrink-0" />
            <span className="text-foreground/80">
              {t('qb_banner', { count: prompts.length })}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            className="ml-4 inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('dismiss')}
          </button>
        </div>
      )}

      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-black text-foreground uppercase tracking-widest">{t('qb_title')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('qb_count', { active: activeCount, total: prompts.length })}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setError(null); setShowPanel(true) }}
            className="inline-flex min-h-11 items-center gap-1.5 text-xs bg-primary/10 text-primary-accessible font-semibold px-3 py-1.5 rounded-lg hover:bg-primary/20 transition"
          >
            <Sparkles className="size-3" /> {t('suggest_more')}
          </button>
        </div>
      </div>

      {(hasUnresolvedSave || error) && <p role="alert" className="text-xs text-red-600 mb-3">{hasUnresolvedSave ? t('panel_save_unknown') : error}</p>}

      <PromptBankEditor clientId={clientId} prompts={prompts} onPromptsChange={setPrompts} contextDefaults={contextDefaults} />

      {/* Slide-in suggest panel */}
      {showPanel && (
          <SuggestQuestionsPanel
            clientId={clientId}
            contextDefaults={contextDefaults}
            onClose={() => setShowPanel(false)}
            onAccepted={handleAccepted}
            hasUnresolvedSave={hasUnresolvedSave}
            onError={(message, unresolved) => {
              setError(message)
              if (unresolved) setHasUnresolvedSave(true)
            }}
          />
      )}
    </div>
  )
}
