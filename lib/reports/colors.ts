/** Agency brand colour handling shared by every report surface. Pure. */

const SYSTEM_PRIMARY = '#1D4ED8'

export function contrastRatio(hex: string, against = '#FFFFFF'): number {
  const luminance = (value: string) => {
    const channels = value.slice(1).match(/.{2}/g)
    if (!channels || channels.length !== 3) return 0
    const linear = channels.map(channel => {
      const number = Number.parseInt(channel, 16) / 255
      return number <= 0.03928
        ? number / 12.92
        : ((number + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
  }
  const first = luminance(hex)
  const second = luminance(against)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

export function accessibleReportPrimaryColor(color: string): string {
  return /^#[0-9A-Fa-f]{6}$/.test(color) && contrastRatio(color) >= 4.5
    ? color
    : SYSTEM_PRIMARY
}

export function reportInitialsForeground(color: string): '#000000' | '#FFFFFF' {
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) return '#FFFFFF'
  return contrastRatio(color, '#000000') >= contrastRatio(color, '#FFFFFF')
    ? '#000000'
    : '#FFFFFF'
}
