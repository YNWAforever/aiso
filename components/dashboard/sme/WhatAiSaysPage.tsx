import type { ReactNode } from 'react'
import { PageHeader } from '@/components/ui/page-header'

/**
 * One container for the five "What AI says" tabs.
 *
 * Before this, each tab invented its own width (3xl/4xl/5xl) and heading. Keeping
 * the shell here means the tab bar, page width and header spacing cannot drift
 * again as the sections are revised.
 */
export function WhatAiSaysPage({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader title={title} description={description} actions={actions} />
      <div className="mt-6 space-y-6">{children}</div>
    </main>
  )
}
