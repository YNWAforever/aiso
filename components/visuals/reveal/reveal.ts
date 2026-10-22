import type { CSSProperties } from 'react'

/**
 * Inline style for the n-th item of a staggered reveal: 40 ms apart, capped at
 * 400 ms. Lives outside RevealObserver.tsx because that module is 'use client',
 * and server components cannot call functions exported from one.
 */
export function revealDelay(index: number): CSSProperties {
  return { ['--reveal-delay' as string]: `${Math.min(index * 40, 400)}ms` }
}
