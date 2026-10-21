import type { ClientReportSnapshotV1 } from '@/lib/reports/types'
import type { ReportSaveResponse } from '@/lib/reports/client-dto'

export const reportClientId = 'synthetic-report-client'
export const reportScanId = 'synthetic-report-scan'

export function reportSnapshot(lang: 'en' | 'zh-HK'): ClientReportSnapshotV1 {
  const english = lang === 'en'
  return {
    snapshotSchemaVersion: 1,
    locale: lang,
    branding: {
      agencyName: english ? 'Synthetic agency — fixture only' : '合成代理商 — 僅供測試',
      logoUrl: null,
      primaryColor: '#123ABC',
      contactLabel: null,
      contactUrl: null,
      attribution: 'Powered by Fimmick AISO',
    },
    client: { name: english ? 'Synthetic report brand' : '合成報告品牌', domain: 'example.test' },
    evidence: {
      scanDate: '2026-10-18T01:00:00.000Z',
      evidenceTimestamp: '2026-10-18T01:00:00.000Z',
    },
    score: { current: 40, grade: 'D', comparisonState: 'baseline' },
    changes: [],
    priorityFixes: [{
      key: 'synthetic-crawler',
      title: english ? 'Review synthetic crawler evidence' : '核對合成爬蟲證據',
      rationale: english ? 'Fixture evidence only; no website was scanned.' : '僅有測試證據；未曾掃描網站。',
      expectedImpact: 'medium',
      nextStep: english ? 'Review the fixture robots.txt before making changes.' : '修改前先核對測試 robots.txt。',
    }],
    executiveSummary: english
      ? 'Synthetic fixture summary: review crawler access using only the selected scan evidence.'
      : '合成測試摘要：只根據指定掃描的完整測試證據核對爬蟲存取設定，並在任何修改前由人手確認所有相關內容。',
    methodology: english ? 'Synthetic fixture only; not a real analysis.' : '僅供合成測試，並非真實分析。',
  }
}

export function reportSaveFixture(
  lang: 'en' | 'zh-HK',
  executiveSummary = reportSnapshot(lang).executiveSummary,
  versionNumber = 1,
): ReportSaveResponse {
  return {
    report: {
      id: 'synthetic-report',
      status: 'draft',
      latestVersionNumber: versionNumber,
      publishedVersionNumber: null,
    },
    reviewArtifact: {
      versionId: `synthetic-version-${versionNumber}`,
      versionNumber,
      snapshot: { ...reportSnapshot(lang), executiveSummary },
    },
  }
}

export function reportBuilderProps(lang: 'en' | 'zh-HK', existing: boolean) {
  const saved = reportSaveFixture(lang)
  return {
    lang,
    saveScope: 'synthetic-account:synthetic-owner',
    clientId: reportClientId,
    scanId: reportScanId,
    initialReport: existing ? saved.report : null,
    initialSnapshot: reportSnapshot(lang),
    initialReviewArtifact: existing ? saved.reviewArtifact : null,
  }
}
