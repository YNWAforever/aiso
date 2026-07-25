'use client'

import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ReportStatus } from '@/lib/reports/types'

export type ReportDisplayStatus =
  | 'draft'
  | 'published'
  | 'published_with_changes'
  | 'revoked'

export function reportDisplayStatus(report: {
  status: ReportStatus
  latestVersionNumber: number | null
  publishedVersionNumber: number | null
}): ReportDisplayStatus {
  if (report.status === 'revoked') return 'revoked'
  if (report.status === 'draft') return 'draft'
  return report.latestVersionNumber !== report.publishedVersionNumber
    ? 'published_with_changes'
    : 'published'
}

export const STATUS_BADGE_COLOR_PAIRS = {
  draft: {
    light: { foreground: '#1E293B', background: '#F1F5F9' },
    dark: { foreground: '#E2E8F0', background: '#141422' },
  },
  published: {
    light: { foreground: '#166534', background: '#F0FDF4' },
    dark: { foreground: '#BBF7D0', background: '#052E16' },
  },
  published_with_changes: {
    light: { foreground: '#78350F', background: '#FFFBEB' },
    dark: { foreground: '#FDE68A', background: '#451A03' },
  },
  revoked: {
    light: { foreground: '#991B1B', background: '#FEF2F2' },
    dark: { foreground: '#FECACA', background: '#450A0A' },
  },
} as const satisfies Record<ReportDisplayStatus, {
  light: { foreground: string; background: string }
  dark: { foreground: string; background: string }
}>

const STATUS_CLASS: Record<ReportDisplayStatus, string> = {
  draft: 'border-slate-300 bg-[#F1F5F9] text-[#1E293B] dark:border-slate-700 dark:bg-[#141422] dark:text-[#E2E8F0]',
  published: 'border-green-300 bg-[#F0FDF4] text-[#166534] dark:border-green-800 dark:bg-[#052E16] dark:text-[#BBF7D0]',
  published_with_changes: 'border-amber-300 bg-[#FFFBEB] text-[#78350F] dark:border-amber-800 dark:bg-[#451A03] dark:text-[#FDE68A]',
  revoked: 'border-red-300 bg-[#FEF2F2] text-[#991B1B] dark:border-red-800 dark:bg-[#450A0A] dark:text-[#FECACA]',
}

export function ReportStatusBadge({
  report,
}: {
  report: {
    status: ReportStatus
    latestVersionNumber: number | null
    publishedVersionNumber: number | null
  }
}) {
  const t = useTranslations('reports')
  const status = reportDisplayStatus(report)

  return (
    <Badge
      variant="outline"
      className={cn('whitespace-normal text-left', STATUS_CLASS[status])}
    >
      {t(`status_${status}`)}
    </Badge>
  )
}
