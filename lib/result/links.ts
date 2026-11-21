import { CHECK_VERSIONS, type EvidenceCheckKey } from '@/lib/scan-evidence-versions'

export function isCheckKey(value: unknown): value is EvidenceCheckKey {
  return typeof value === 'string' && Object.hasOwn(CHECK_VERSIONS, value)
}

export type ScanSelection = { scanId: string; check?: EvidenceCheckKey }

export function selectionQuery({ scanId, check }: ScanSelection): string {
  const params = new URLSearchParams({ scanId })
  if (check) params.set('check', check)
  return params.toString()
}

export function findingHref(brand: string, scanId: string, check: EvidenceCheckKey): string {
  return `${brand}?step=results&${selectionQuery({ scanId, check })}#check-${check}`
}

export function isScanId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
}

export function scanReportHref(lang: string, clientId: string, scanId: string): string {
  return `/${lang}/dashboard/${encodeURIComponent(clientId)}/result/${encodeURIComponent(scanId)}`
}
