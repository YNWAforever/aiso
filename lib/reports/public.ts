import 'server-only'

import { parseClientReportSnapshot } from './client-dto'
import { publicReportHeaders } from './public-security'
export { PUBLIC_REPORT_CSP, publicReportHeaders } from './public-security'
import { verifyReportShare } from './share'
import { resolvePublicClientReport } from './store'
import { resolveCommercialEntitlement } from '@/lib/tier'
import type {
  ClientReportSnapshotV1,
  PublicClientReportDto,
} from './types'

type PublicReportAsset = 'contact' | 'logo'

export type ResolvedPublishedClientReport = Readonly<{
  dto: PublicClientReportDto
  assets: Readonly<{
    logoUrl: string | null
    contactUrl: string | null
  }>
}>

export function neutralPublicReportNotFound(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: publicReportHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }),
  })
}

function parseShareVersion(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed <= 2_147_483_647 ? parsed : null
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value))
}

function publicAssetUrl(
  asset: PublicReportAsset,
  slug: string,
  shareVersion: number,
  signature: string,
): string {
  const query = new URLSearchParams({ v: String(shareVersion), s: signature })
  return `/api/public/client-reports/${encodeURIComponent(slug)}/${asset}?${query}`
}

function copyPublishedSnapshot(snapshot: ClientReportSnapshotV1): ClientReportSnapshotV1 {
  return {
    snapshotSchemaVersion: 1,
    locale: snapshot.locale,
    branding: {
      agencyName: snapshot.branding.agencyName,
      logoUrl: snapshot.branding.logoUrl,
      primaryColor: snapshot.branding.primaryColor,
      contactLabel: snapshot.branding.contactLabel,
      contactUrl: snapshot.branding.contactUrl,
      attribution: 'Powered by Fimmick AISO',
    },
    client: {
      name: snapshot.client.name,
      domain: snapshot.client.domain,
    },
    evidence: {
      scanDate: snapshot.evidence.scanDate,
      evidenceTimestamp: snapshot.evidence.evidenceTimestamp,
    },
    score: snapshot.score.comparisonState === 'comparable'
      ? {
          current: snapshot.score.current,
          grade: snapshot.score.grade,
          comparisonState: 'comparable',
          previous: snapshot.score.previous,
          delta: snapshot.score.delta,
          previousScanDate: snapshot.score.previousScanDate,
        }
      : {
          current: snapshot.score.current,
          grade: snapshot.score.grade,
          comparisonState: snapshot.score.comparisonState,
        },
    changes: snapshot.changes.map(change => ({
      key: change.key,
      label: change.label,
      kind: change.kind,
    })),
    priorityFixes: snapshot.priorityFixes.slice(0, 5).map(fix => ({
      key: fix.key,
      title: fix.title,
      rationale: fix.rationale,
      expectedImpact: fix.expectedImpact,
      nextStep: fix.nextStep,
    })),
    executiveSummary: snapshot.executiveSummary,
    methodology: snapshot.methodology,
  }
}

function unavailable(reason: 'lookup' | 'state' | 'snapshot' | 'entitlement'): null {
  console.warn('[public-report] unavailable', { reason })
  return null
}

export async function resolvePublishedClientReport(input: {
  readonly slug: unknown
  readonly version: unknown
  readonly signature: unknown
}): Promise<ResolvedPublishedClientReport | null> {
  const shareVersion = parseShareVersion(input.version)
  if (
    typeof input.slug !== 'string'
    || typeof input.signature !== 'string'
    || shareVersion === null
  ) return null

  try {
    if (!verifyReportShare({
      slug: input.slug,
      shareVersion,
      signature: input.signature,
    })) return null
  } catch {
    return unavailable('state')
  }

  try {
    const stored = await resolvePublicClientReport({
      publicSlug: input.slug,
      shareVersion,
    })
    if (!stored) return null

    const { report, version, account } = stored
    if (
      report.status !== 'published'
      || report.public_slug !== input.slug
      || report.share_version !== shareVersion
      || !report.published_version_id
      || report.published_version_id !== version.id
      || !validTimestamp(report.published_at)
      || version.report_id !== report.id
      || version.account_id !== report.account_id
      || version.client_id !== report.client_id
      || version.snapshot_schema_version !== 1
      || account.id !== report.account_id
    ) return unavailable('state')

    const entitlement = resolveCommercialEntitlement(account)
    if (!entitlement.features.client_reports_online) return unavailable('entitlement')

    const parsed = parseClientReportSnapshot(version.snapshot)
    if (
      !parsed
      || parsed.locale !== version.locale
      || !validTimestamp(parsed.evidence.scanDate)
      || !validTimestamp(parsed.evidence.evidenceTimestamp)
    ) return unavailable('snapshot')

    const publishedSnapshot = copyPublishedSnapshot(parsed)
    const hasLogo = publishedSnapshot.branding.logoUrl !== null
    const hasContact = publishedSnapshot.branding.contactLabel !== null
      && publishedSnapshot.branding.contactUrl !== null

    return {
      dto: {
        report: publishedSnapshot,
        publishedAt: report.published_at,
        logoProxyUrl: hasLogo
          ? publicAssetUrl('logo', input.slug, shareVersion, input.signature)
          : null,
        contactProxyUrl: hasContact
          ? publicAssetUrl('contact', input.slug, shareVersion, input.signature)
          : null,
      },
      assets: {
        logoUrl: publishedSnapshot.branding.logoUrl,
        contactUrl: hasContact ? publishedSnapshot.branding.contactUrl : null,
      },
    }
  } catch {
    return unavailable('lookup')
  }
}
