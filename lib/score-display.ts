/** Display persisted 0–100 scan totals without changing their grade or stored value. */
export function formatScanScore(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new RangeError('Invalid scan score')
  return String(Number(value.toFixed(2)))
}
