/**
 * Score grade and check status → semantic tone.
 *
 * One mapping for every visual, so a "C" or a warning is the same colour on
 * the ring, the badge, the heatmap and the gauge. Colour is never the only cue:
 * each consumer also prints the grade letter or a status icon.
 */
export type Tone = 'success' | 'info' | 'warning' | 'danger' | 'neutral'
export type Grade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F'
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'unknown'
export type Pillar = 'core' | 'extended' | 'geo'

export const GRADES: readonly Grade[] = ['A+', 'A', 'B', 'C', 'D', 'F']
export const PILLARS: readonly Pillar[] = ['core', 'extended', 'geo']

const GRADE_TONE: Record<Grade, Tone> = { 'A+': 'success', A: 'success', B: 'info', C: 'warning', D: 'warning', F: 'danger' }
const STATUS_TONE: Record<CheckStatus, Tone> = { pass: 'success', warn: 'warning', fail: 'danger', unknown: 'neutral' }

export function isGrade(value: string): value is Grade {
  return (GRADES as readonly string[]).includes(value)
}

export function gradeTone(grade: string): Tone {
  return isGrade(grade) ? GRADE_TONE[grade] : 'neutral'
}

export function statusTone(status: CheckStatus): Tone {
  return STATUS_TONE[status]
}

/** Message key segment for a grade ("A+" is not a valid key). */
export function gradeKey(grade: string): string {
  return grade === 'A+' ? 'aPlus' : isGrade(grade) ? grade.toLowerCase() : 'unknown'
}

/** Pillar share of the 100-point score (lib/scoring.ts: CORE 45 / EXT 30 / GEO 25). */
export const PILLAR_MAX: Record<Pillar, number> = { core: 45, extended: 30, geo: 25 }

// Literal class strings so Tailwind's scanner sees every one.
export const TONE_CLASSES: Record<Tone, { stroke: string; fill: string; soft: string; fg: string; border: string }> = {
  success: { stroke: 'stroke-tone-success', fill: 'bg-tone-success', soft: 'bg-tone-success-soft', fg: 'text-tone-success-fg', border: 'border-tone-success/40' },
  info:    { stroke: 'stroke-tone-info',    fill: 'bg-tone-info',    soft: 'bg-tone-info-soft',    fg: 'text-tone-info-fg',    border: 'border-tone-info/40' },
  warning: { stroke: 'stroke-tone-warning', fill: 'bg-tone-warning', soft: 'bg-tone-warning-soft', fg: 'text-tone-warning-fg', border: 'border-tone-warning/40' },
  danger:  { stroke: 'stroke-tone-danger',  fill: 'bg-tone-danger',  soft: 'bg-tone-danger-soft',  fg: 'text-tone-danger-fg',  border: 'border-tone-danger/40' },
  neutral: { stroke: 'stroke-neutral-8',    fill: 'bg-neutral-8',    soft: 'bg-neutral-3',         fg: 'text-neutral-11',      border: 'border-neutral-6' },
}
