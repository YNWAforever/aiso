'use client'
import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'
import { cn } from '@/lib/utils'

/** Determinate progress. The indicator scales on X rather than changing width. */
const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, max = 100, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    value={value}
    max={max}
    className={cn('relative h-2 w-full overflow-hidden rounded-full bg-neutral-4', className)}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="h-full w-full origin-left bg-primary transition-transform duration-300 ease-standard motion-reduce:transition-none"
      style={{ transform: `scaleX(${Math.min(1, Math.max(0, (value ?? 0) / max))})` }}
    />
  </ProgressPrimitive.Root>
))
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
