import { normalizeScanUrl } from '@/lib/scan-input'

/** Syntax only. The API remains responsible for ownership and DNS-pinned fetching. */
export function onboardingWebsiteUrl(value: string): string | null {
  try {
    const url = new URL(normalizeScanUrl(value))
    const host = url.hostname.replace(/\.$/, '')
    if (host.length > 253 || /^\d+(?:\.\d+){3}$/.test(host)
      || host.split('.').some(label => !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))) return null
    return url.href
  } catch {
    return null
  }
}

export function onboardingDestination(lang: string, clientId: string, setup: {
  scanId?: string; domain?: string; industry?: string; region?: string
}): string {
  const workspace = `/${lang}/dashboard/${encodeURIComponent(clientId)}`
  if (setup.scanId) return `${workspace}/result/${encodeURIComponent(setup.scanId)}`
  const website = setup.domain ? onboardingWebsiteUrl(`https://${setup.domain}`) : null
  if (!website) return `${workspace}/prompts`
  const query = new URLSearchParams({ step: 'scan', url: website })
  if (setup.industry) query.set('industry', setup.industry)
  if (setup.region) query.set('region', setup.region)
  return `${workspace}?${query}`
}
