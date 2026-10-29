'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/** Route-aware presentation only. Server layouts/pages retain all authorization. */
export function DashboardChrome({ children, sidebar, topbar, banner, conversationStudio }: {
  children: ReactNode; sidebar: ReactNode; topbar: ReactNode; banner?: ReactNode; conversationStudio: boolean
}) {
  const pathname = usePathname() ?? ''
  const studio = conversationStudio && /^\/(en|zh-HK)\/dashboard\/[a-f0-9-]{36}\/studio(?:\/|$)/i.test(pathname)
  if (studio) return <div className="h-dvh min-w-0 overflow-auto">{children}</div>
  return <div className="flex flex-col h-screen bg-background overflow-hidden print:h-auto print:overflow-visible print:bg-white">
    {banner}
    <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden print:block print:overflow-visible">
      {sidebar}
      <div className="flex-1 min-w-0 w-full flex flex-col overflow-auto print:block print:overflow-visible">
        {topbar}{children}
      </div>
    </div>
  </div>
}
