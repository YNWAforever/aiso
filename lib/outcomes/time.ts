export const UTC_DAY_MICROS = BigInt(86400) * BigInt(1000000)
/** Date handles only whole seconds; fractional precision never passes through Number. */
export function utcMicros(value: string): bigint {
  if (typeof value !== 'string') throw new TypeError('Invalid UTC timestamp')
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(value)
  if (!match) throw new TypeError('Invalid UTC timestamp')
  const millis = Date.parse(`${match[1]}.000Z`)
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== `${match[1]}.000Z`) throw new TypeError('Invalid UTC calendar date')
  return BigInt(millis) * BigInt(1000) + BigInt((match[2] ?? '').padEnd(6, '0'))
}
export function formatUtcMicros(value: bigint): string {
  // Floor division is needed before the Unix epoch (BigInt division truncates).
  const fraction = ((value % BigInt(1000000)) + BigInt(1000000)) % BigInt(1000000)
  const seconds = (value - fraction) / BigInt(1000000)
  const date = new Date(Number(seconds * BigInt(1000)))
  if (!Number.isFinite(date.getTime())) throw new RangeError('UTC timestamp out of range')
  const iso = date.toISOString()
  if (!/^\d{4}-/.test(iso)) throw new RangeError('UTC timestamp out of range')
  return `${iso.slice(0, 19)}.${fraction.toString().padStart(6, '0')}Z`
}
