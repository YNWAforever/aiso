/** Display persisted 0–100 scan totals without changing their grade or stored value. */
export function formatScanScore(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new RangeError('Invalid scan score')
  return String(Number(value.toFixed(2)))
}

/** Formats old and new human-readable C18 details without changing stored evidence. */
export function formatFactualDensityDetails(details: string): string {
  const match = /^Quality score (\d+(?:\.\d+)?)\/100$/.exec(details)
  if (!match) return details
  const value = Number(match[1])
  if (!Number.isFinite(value) || value < 0 || value > 100) return details
  return `Quality score ${formatScanScore(value)}/100`
}

/** Half-open grade bands; the legal score domain ends at 100. */
export const SCAN_GRADE_BANDS: readonly { grade: string; minInclusive: number; maxExclusive: number | null }[] = [
  { grade: 'F', minInclusive: 0, maxExclusive: 50 },
  { grade: 'D', minInclusive: 50, maxExclusive: 60 },
  { grade: 'C', minInclusive: 60, maxExclusive: 70 },
  { grade: 'B', minInclusive: 70, maxExclusive: 80 },
  { grade: 'A', minInclusive: 80, maxExclusive: 90 },
  { grade: 'A+', minInclusive: 90, maxExclusive: null },
]
