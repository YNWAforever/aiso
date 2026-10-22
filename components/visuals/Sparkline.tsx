import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

export interface SparklineProps {
  points: readonly number[]
  /** What the series is, e.g. "Score". Used in the accessible summary. */
  label: string
  width?: number
  height?: number
  className?: string
}

/**
 * A trend line with no axes. Plain SVG rather than Recharts: it is drawn inside
 * stat cards, often several to a screen, and needs no interaction. Static, so
 * there is nothing to reduce for reduced motion.
 */
export function Sparkline({ points, label, width = 96, height = 28, className }: SparklineProps) {
  const t = useTranslations('visuals')
  if (points.length < 2) return null

  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const stepX = width / (points.length - 1)
  const pad = 2
  const coords = points.map((p, i) => [i * stepX, pad + (height - pad * 2) * (1 - (p - min) / span)] as const)
  const line = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const area = `${line} L${width} ${height} L0 ${height} Z`
  const change = Math.round((points[points.length - 1]! - points[0]!) * 100) / 100
  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
  const [lastX, lastY] = coords[coords.length - 1]!

  return (
    <svg
      role="img"
      aria-label={t('sparkline.summary', { label, direction, change: Math.abs(change), count: points.length })}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
    >
      <path d={area} className="fill-primary/10" />
      <path d={line} fill="none" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="stroke-primary" />
      <circle cx={lastX} cy={lastY} r={2.5} className="fill-primary" />
    </svg>
  )
}
