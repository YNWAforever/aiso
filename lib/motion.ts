/**
 * Shared motion vocabulary (docs/ux/visual-system.md §2).
 *
 * Every animation in the app takes its curve, durations and variants from here
 * so the product moves as one system. Rules the values encode:
 *  - transform and opacity only (ring strokes animate stroke-dashoffset, the one
 *    sanctioned exception, because it is SVG-composited and moves no layout);
 *  - 150–300 ms for UI, at most 800 ms for count-ups and ring fills;
 *  - one easing curve; exits run at 0.8× the entry duration;
 *  - reduced motion renders the end state, it does not merely go faster.
 *
 * Plain data and pure functions only, so server components can import it. The
 * React-side helpers live in components/visuals/MotionRoot.tsx.
 */

/** The one curve. Mirrors `--ease-standard` in app/globals.css. */
export const EASE = [0.2, 0, 0, 1] as const
export const EASE_CSS = 'cubic-bezier(0.2, 0, 0, 1)'

/** Seconds, as `motion` expects. */
export const DURATION = {
  micro: 0.15,
  ui: 0.2,
  enter: 0.25,
  drawer: 0.3,
  count: 0.8,
} as const

export const STAGGER = 0.04
export const MAX_STAGGER_TOTAL = 0.4

/** Delay for item `index`: 40 ms apart, compressed so the whole group lands within 400 ms. */
export function staggerDelay(index: number, count: number): number {
  if (index <= 0 || count <= 1) return 0
  const step = Math.min(STAGGER, MAX_STAGGER_TOTAL / (count - 1))
  return Math.round(index * step * 1000) / 1000
}

export function transition(duration: number = DURATION.ui, delay = 0) {
  return { duration, delay, ease: EASE }
}

/** Exit transition: same curve, 0.8× the entry duration. */
export function exitTransition(duration: number = DURATION.ui) {
  return { duration: Math.round(duration * 0.8 * 1000) / 1000, ease: EASE }
}

type Variant = Record<string, number | string>
type VariantSet = { hidden: Variant; visible: Variant; exit?: Variant }

export const variants = {
  fade: { hidden: { opacity: 0 }, visible: { opacity: 1 }, exit: { opacity: 0 } },
  fadeUp: { hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 8 } },
  scaleIn: { hidden: { opacity: 0, scale: 0.92 }, visible: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.96 } },
  toast: { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 8 } },
  drawerRight: { hidden: { x: '100%' }, visible: { x: 0 }, exit: { x: '100%' } },
  drawerBottom: { hidden: { y: '100%' }, visible: { y: 0 }, exit: { y: '100%' } },
} as const satisfies Record<string, VariantSet>

/** Critically damped: settles without overshoot. The drawer is the only spring. */
export const DRAWER_SPRING = { type: 'spring', stiffness: 420, damping: 41, mass: 1 } as const

/** Ease-out-cubic, for count-ups driven outside `motion`. */
export function easeOut(progress: number): number {
  const p = Math.min(1, Math.max(0, progress))
  return 1 - Math.pow(1 - p, 3)
}

/**
 * The value a count-up shows at `progress`. Intermediate values round DOWN, so a
 * ticker never overshoots and then settles back onto the real score.
 */
export function countUpValue(target: number, progress: number, decimals = 0): number {
  if (progress >= 1) return target
  const factor = 10 ** decimals
  return Math.floor(easeOut(progress) * target * factor) / factor
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}
