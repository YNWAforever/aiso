import type { Scan } from '@/lib/types'

export function normalizeDomain(domain: string | null | undefined) {
  const value = domain?.trim().toLowerCase()
  if (!value) return null

  return value
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    ?.split(':')[0] || null
}

export function domainsMatch(scanDomain: string | null | undefined, clientDomain: string | null | undefined) {
  const normalizedScan = normalizeDomain(scanDomain)
  const normalizedClient = normalizeDomain(clientDomain)

  return Boolean(normalizedScan && normalizedClient && normalizedScan === normalizedClient)
}

export function findNewestMatchingScan(scans: Scan[], clientDomain: string | null | undefined) {
  return scans.find(scan => domainsMatch(scan.domain, clientDomain)) ?? null
}
