/**
 * The owner-figure value line: count x close rate x lead value. Pure.
 *
 * The figures come from the driver as strings (`close_rate` is a numeric
 * column) or as null when the owner never entered them. Coercion is strict:
 * `Number(null)` and `Number('')` are both `0`, and letting them through would
 * print a made-up `HK$0`. A missing or non-finite figure means no value line
 * (null); a `0` lead value or close rate is a real figure and returns `0`.
 */

function figure(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    if (value.trim() === '') return null
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function observedValue(
  count: number,
  owner: { leadValue: unknown; closeRate: unknown },
): number | null {
  if (!Number.isFinite(count)) return null
  const leadValue = figure(owner.leadValue)
  const closeRate = figure(owner.closeRate)
  if (leadValue === null || closeRate === null) return null
  if (closeRate < 0 || closeRate > 1 || leadValue < 0) return null
  return Math.round(count * closeRate * leadValue)
}
