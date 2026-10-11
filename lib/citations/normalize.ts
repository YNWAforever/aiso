import {getDomain} from 'tldts'
export const CITATION_NORMALIZATION_VERSION='psl-private-tldts-7.4.10.v1'

/** Query parameters that only identify a click, never a page. */
const TRACKING_PARAMS = /^(utm_[a-z]+|gclid|fbclid|msclkid|mc_[a-z]+|ref|ref_src|igshid|spm)$/i

const stripWww = (host: string) => {
 const stripped=host.replace(/^www\d?\./, '')
 // WWW can be the private site's registrable tenant label, rather than a subdomain.
 return stripped!==host&&getDomain(host,{allowPrivateDomains:true})===host?host:stripped
}

/** HTTP(S) only, lower-case host without `www.`, no fragment, no tracking parameters, no trailing slash. */
export function normalizeCitationUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  let url: URL
  try { url = new URL(value.trim()) } catch { return null }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  url.hash = ''
  url.hostname = stripWww(url.hostname.toLowerCase())
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key)
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString()
}

/** Host-only validation. Invalid values use a disjoint namespace, never a real domain. */
function canonicalHost(host:string):string|null {
 if(!host||host!==host.trim()||/[\s/@?#\\]/.test(host)||(host.includes(':')&&!/^\[[0-9a-f:.]+\]$/i.test(host)))return null
 try{const clean=stripWww(new URL('https://'+host).hostname.toLowerCase().replace(/\.$/,''));if(clean.startsWith('['))return clean;if(clean.length>253||clean.split('.').some(label=>!label||label.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))return null;return clean}catch{return null}
}
export function registrableDomain(host:string):string {
 const clean=canonicalHost(host);return clean?getDomain(clean,{allowPrivateDomains:true})??clean:'invalid:'+encodeURIComponent(host)
}
export function isWithin(host:string,domain:string):boolean {
 const h=canonicalHost(host),d=canonicalHost(domain);return !!h&&!!d&&(h===d||h.endsWith('.'+d))
}
