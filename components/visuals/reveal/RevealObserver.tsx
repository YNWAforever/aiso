'use client'
import { useEffect } from 'react'

/**
 * The one script behind every CSS reveal on a page: marks each `[data-reveal]`
 * element with `data-revealed` as it scrolls into view, and the stylesheet's
 * transitions do the rest (app/globals.css, "Reveal"). Server-rendered
 * visuals use this instead of `motion`, so nothing below the fold hydrates.
 * Render it once per page.
 */
export function RevealObserver() {
  useEffect(() => {
    const targets = document.querySelectorAll<HTMLElement>('[data-reveal]:not([data-revealed])')
    if (!('IntersectionObserver' in window)) {
      targets.forEach(el => el.setAttribute('data-revealed', ''))
      return
    }
    // Any overlap, measured against a viewport trimmed by 10% at the bottom: a
    // ratio threshold would never fire on a section taller than the viewport
    // divided by that ratio (the sample card at 400% zoom), leaving it hidden.
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.setAttribute('data-revealed', '')
        observer.unobserve(entry.target)
      }
    }, { threshold: 0, rootMargin: '0px 0px -10% 0px' })
    targets.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [])
  return null
}

