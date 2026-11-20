export function isScanId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
}

export function scanReportHref(lang: string, clientId: string, scanId: string): string {
  return `/${lang}/dashboard/${encodeURIComponent(clientId)}/result/${encodeURIComponent(scanId)}`
}
