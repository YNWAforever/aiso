'use client'
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { LazyMotion, MotionConfig, domAnimation, useReducedMotionConfig } from 'motion/react'
import { DURATION, EASE, countUpValue } from '@/lib/motion'

type ReducedMotionSetting = 'user' | 'always' | 'never'

/**
 * Lets a container force a reduced-motion setting on every visual below it.
 * Needed because each visual brings its own MotionConfig, and an inner
 * MotionConfig would otherwise override an outer one.
 */
const ReducedMotionOverride = createContext<ReducedMotionSetting | null>(null)

export function ReducedMotionPreview({ setting, children }: { setting: ReducedMotionSetting; children: ReactNode }) {
  return <ReducedMotionOverride.Provider value={setting}>{children}</ReducedMotionOverride.Provider>
}

/**
 * The motion boundary every animated visual renders inside.
 *
 * LazyMotion + domAnimation keeps `motion` to its small feature bundle, and
 * `strict` makes a stray full `motion.*` component throw instead of silently
 * pulling the whole library back in. Nested roots are harmless, which is why
 * each visual brings its own rather than relying on an app-level provider.
 *
 * Reduced motion follows the OS setting unless a ReducedMotionPreview above
 * says otherwise (the design-system page uses one to preview the static frames).
 */
export function MotionRoot({ children, reducedMotion }: { children: ReactNode; reducedMotion?: ReducedMotionSetting }) {
  const override = useContext(ReducedMotionOverride)
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion={reducedMotion ?? override ?? 'user'} transition={{ duration: DURATION.ui, ease: EASE }}>
        {children}
      </MotionConfig>
    </LazyMotion>
  )
}

const noSubscribe = () => () => {}

/**
 * True when animation should be skipped: OS preference or a MotionConfig override.
 *
 * Always false during hydration. The server cannot know the preference, so a
 * client that rendered its reduced frame on the first pass would mismatch the
 * server HTML, and React recovers from that by re-rendering the whole document
 * on the client, which drops the `dark` class the theme script put on <html>.
 * useSyncExternalStore's server snapshot gives the hydration pass the server's
 * answer, and the real one arrives in the very next render.
 */
export function useReducedMotion(): boolean {
  const config = useReducedMotionConfig()
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false)
  return hydrated && Boolean(config)
}

/**
 * A number that counts up to `target` once `start` is true.
 *
 * Renders the start value (0) on the server and before hydration; reduced
 * motion jumps straight to the target. When `enabled` is false it is simply
 * `target`, which is what print, reports and static previews want.
 */
export function useCountUp(target: number, { enabled = true, start = true, decimals = 0, duration = DURATION.count } = {}): number {
  const reduced = useReducedMotion()
  const [value, setValue] = useState(enabled ? 0 : target)
  const frame = useRef<number | null>(null)

  const settled = !enabled || reduced

  useEffect(() => {
    if (settled || !start) return
    const begin = performance.now()
    const tick = (now: number) => {
      const progress = (now - begin) / (duration * 1000)
      setValue(countUpValue(target, progress, decimals))
      if (progress < 1) frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => { if (frame.current) cancelAnimationFrame(frame.current) }
  }, [target, settled, start, decimals, duration])

  return settled ? target : value
}
