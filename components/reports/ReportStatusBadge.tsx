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

const STATUS_CLASS: Record<ReportDisplayStatus, string> = {
  draft: 'border-border bg-muted text-muted-foreground',
  published: 'border-success/30 bg-success/10 text-success',
  published_with_changes: 'border-warning/30 bg-warning/10 text-warning-foreground',
  revoked: 'border-destructive/30 bg-destructive/10 text-destructive',
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
