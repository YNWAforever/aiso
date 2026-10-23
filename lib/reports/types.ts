export const REPORT_SNAPSHOT_SCHEMA_VERSION = 1 as const
export const REPORT_LOCALES = ['en', 'zh-HK'] as const

export type ReportLocale = (typeof REPORT_LOCALES)[number]
export type ComparisonState = 'baseline' | 'comparable' | 'not_comparable'
export type ReportStatus = 'draft' | 'published' | 'revoked'
export type ChangeKind = 'improved' | 'regressed' | 'unchanged' | 'added_coverage' | 'lost_coverage' | 'data_gap'

export interface ReportBrandingSnapshot {
  agencyName: string
  logoUrl: string | null
  primaryColor: string
  contactLabel: string | null
  contactUrl: string | null
  attribution: 'Powered by Fimmick AISO'
}

export interface ReportPriorityFix {
  key: string
  title: string
  rationale: string
  expectedImpact: 'high' | 'medium' | 'low'
  nextStep: string
}

/** A check's evidence-backed verdict, the same vocabulary the public result heatmap draws. */
export type ReportCheckStatus = 'pass' | 'warn' | 'fail' | 'unknown' | 'not-applicable'

export interface ReportTrendPoint {
  date: string
  score: number
  /**
   * Collected the same way as the point before it (compareScanEvidence). The
   * first point is always true; a false point means the move into it may be a
   * change of method, not of the site.
   */
  comparable: boolean
}

export interface ClientReportSnapshotV1 {
  snapshotSchemaVersion: 1
  locale: ReportLocale
  branding: ReportBrandingSnapshot
  client: { name: string; domain: string }
  evidence: { scanDate: string; evidenceTimestamp: string }
  score: { current: number; grade: string; comparisonState: ComparisonState; previous?: number; delta?: number; previousScanDate?: string }
  changes: ReadonlyArray<{ key: string; label: string; kind: ChangeKind }>
  priorityFixes: ReadonlyArray<ReportPriorityFix>
  executiveSummary: string
  methodology: string
  /**
   * Optional, frozen at build. Versions built before the one-page report have
   * neither, so every reader treats absence as "not recorded", never as zero.
   */
  checks?: Readonly<Record<string, ReportCheckStatus>>
  /** Oldest first, ending with this report's own scan; at least two points. */
  trend?: ReadonlyArray<ReportTrendPoint>
}

export type PublicReportBrandingSnapshot = Omit<ReportBrandingSnapshot, 'logoUrl' | 'contactUrl'> & {
  logoUrl: null
  contactUrl: null
}

export type PublicClientReportSnapshot = Omit<ClientReportSnapshotV1, 'branding'> & {
  branding: PublicReportBrandingSnapshot
}

export type PublicClientReportDto = Readonly<{
  report: PublicClientReportSnapshot
  publishedAt: string
  logoProxyUrl: string | null
  contactProxyUrl: string | null
}>

export interface ReportScanInput {
  readonly accountId: string
  readonly domain: string
  readonly createdAt: string
  readonly score: number
  readonly grade: string
  readonly results: unknown
}

export interface ReportRecommendationInput {
  readonly key: string
  readonly title: string
  readonly rationale: string
  readonly expectedImpact: 'high' | 'medium' | 'low'
  readonly nextStep: string
}

export interface ReportBrandingInput {
  readonly agencyName: string
  readonly logoUrl: string | null
  readonly primaryColor: string
  readonly contactLabel: string | null
  readonly contactUrl: string | null
}

export interface ReportClientInput {
  readonly name: string
  readonly domain: string
}
