/** Syntax shared by the form and API; server DNS/redirect checks remain mandatory. */
export function normalizeScanUrl(value: string): string {
  const input = value.trim()
  if (!input) throw new Error('empty_url')
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(input)
  const url = new URL(hasScheme ? input : `https://${input}`)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid_protocol')
  if (url.username || url.password) throw new Error('invalid_credentials')
  const host = url.hostname.replace(/\.$/, '')
  if ((!host.includes('.') && !host.startsWith('[')) || /(^|\.)(localhost|local|internal)$/i.test(host)) {
    throw new Error('invalid_hostname')
  }
  return url.href
}
