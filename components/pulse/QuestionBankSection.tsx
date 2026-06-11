// components/pulse/QuestionBankSection.tsx
'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Sparkles } from 'lucide-react'
import { PromptBankEditor } from './PromptBankEditor'
import { SuggestQuestionsPanel } from './SuggestQuestionsPanel'
import type { PromptBankItem } from '@/lib/types'

interface Props {
  clientId: string
  initialPrompts: PromptBankItem[]
  isFirstTime: boolean   // true when prompt bank was just auto-generated
}

export function QuestionBankSection({ clientId, initialPrompts, isFirstTime }: Props) {
  const t = useTranslations('pulse')
  const [showPanel, setShowPanel] = useState(false)
  const [prompts, setPrompts] = useState<PromptBankItem[]>(initialPrompts)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  const activeCount = prompts.filter(p => p.is_active).length

  function handleAccepted(question: string, category: string) {
    // Optimistically add to prompt list
    const newPrompt: PromptBankItem = {
      id: `temp-${Date.now()}`,
      client_id: clientId,
      category,
      question,
      language: 'en',
      is_active: true,
      created_at: new Date().toISOString(),
    }
    setPrompts(prev => [...prev, newPrompt])
  }

  return (
    <div id="question-bank" className="relative">
      {/* First-time banner */}
      {isFirstTime && !bannerDismissed && (
        <div className="flex items-center justify-between bg-primary/10 border border-primary/20 rounded-xl px-4 py-3 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <Sparkles className="size-4 text-primary shrink-0" />
            <span className="text-slate-700">
              {t('qb_banner', { count: prompts.length })}
            </span>
          </div>
          <button
            onClick={() => setBannerDismissed(true)}
            className="text-slate-400 hover:text-slate-600 text-xs ml-4 shrink-0"
          >
            {t('dismiss')}
          </button>
        </div>
      )}

      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">{t('qb_title')}</h2>
          <p className="text-xs text-slate-400 mt-0.5">{t('qb_count', { active: activeCount, total: prompts.length })}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowPanel(true)}
            className="inline-flex items-center gap-1.5 text-xs bg-primary/10 text-primary font-semibold px-3 py-1.5 rounded-lg hover:bg-primary/20 transition"
          >
            <Sparkles className="size-3" /> {t('suggest_more')}
          </button>
        </div>
      </div>

      <PromptBankEditor clientId={clientId} initialPrompts={prompts} />

      {/* Slide-in suggest panel */}
      {showPanel && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setShowPanel(false)} />
          <SuggestQuestionsPanel
            clientId={clientId}
            onClose={() => setShowPanel(false)}
            onAccepted={handleAccepted}
          />
        </>
      )}
    </div>
  )
}
