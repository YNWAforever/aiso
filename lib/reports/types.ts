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
}

export type PublicClientReportDto = Readonly<{
  report: ClientReportSnapshotV1
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
