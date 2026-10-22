import { cn } from '@/lib/utils'

/**
 * A placeholder block with a moving sheen (a translated gradient, not a
 * background-position animation). Reduced motion leaves a still block.
 * Decorative: the region it sits in should carry `aria-busy`.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative block overflow-hidden rounded-md bg-neutral-4',
        'after:absolute after:inset-0 after:-translate-x-full after:animate-shimmer after:bg-gradient-to-r after:from-transparent after:via-neutral-1/60 after:to-transparent motion-reduce:after:hidden',
        className,
      )}
    />
  )
}

/** A paragraph-shaped stack of skeleton lines; the last is shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3', i === lines - 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </span>
  )
}
