'use client'

import { usePathname } from 'next/navigation'
import { Suspense, type ReactNode } from 'react'
import { SmeSectionTabs } from '@/components/dashboard/shell/SmeSectionTabs'

/** Route-aware presentation only. Server layouts/pages retain all authorization. */
export function DashboardChrome({ children, sidebar, topbar, banner, conversationStudio, smeCopilot = false }: {
  children: ReactNode; sidebar: ReactNode; topbar: ReactNode; banner?: ReactNode; conversationStudio: boolean
  /** Approved SME copilot IA: Chat lives inside the one dashboard shell, so no full-bleed branch. */
  smeCopilot?: boolean
}) {
  const pathname = usePathname() ?? ''
  const studio = conversationStudio && /^\/(en|zh-HK)\/dashboard\/[a-f0-9-]{36}\/studio(?:\/|$)/i.test(pathname)
  if (studio && !smeCopilot) return <div className="h-dvh min-w-0 overflow-auto">{children}</div>
  return <div className="flex flex-col h-screen bg-background overflow-hidden print:h-auto print:overflow-visible print:bg-white">
    {banner}
    <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden print:block print:overflow-visible">
      {sidebar}
      <div className="flex-1 min-w-0 w-full flex flex-col overflow-auto print:block print:overflow-visible">
        {topbar}{smeCopilot && <Suspense fallback={null}><SmeSectionTabs /></Suspense>}{children}
      </div>
    </div>
  </div>
}
