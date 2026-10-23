'use client'

import type { ClientReportSnapshotV1 } from '@/lib/reports/types'
import { OnePageReport } from './OnePageReport'

export { accessibleReportPrimaryColor, contrastRatio, reportInitialsForeground } from '@/lib/reports/colors'

/** The dashboard's review of a version: the client's one-page report, under the builder's own heading. */
export function ReportPreview({
  snapshot,
  logoProxyUrl,
  contactProxyUrl,
}: {
  snapshot: ClientReportSnapshotV1
  logoProxyUrl?: string | null
  contactProxyUrl?: string | null
}) {
  return (
    <OnePageReport
      variant="embedded"
      snapshot={snapshot}
      logoProxyUrl={logoProxyUrl?.startsWith('/api/client-reports/') ? logoProxyUrl : null}
      contactProxyUrl={contactProxyUrl?.startsWith('/api/client-reports/') ? contactProxyUrl : null}
    />
  )
}
