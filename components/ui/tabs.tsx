'use client'
import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn('flex gap-1 overflow-x-auto border-b border-border', className)} {...props} />
))
TabsList.displayName = TabsPrimitive.List.displayName

/** The active underline grows from the centre with scaleX (Phase 7 adds the slide between tabs). */
const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-muted-foreground transition-colors duration-150 hover:text-foreground',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
      'after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:scale-x-0 after:rounded-full after:bg-primary after:transition-transform after:duration-200 after:ease-standard motion-reduce:after:transition-none',
      'data-[state=active]:text-foreground data-[state=active]:after:scale-x-100',
      className,
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('pt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)} {...props} />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
