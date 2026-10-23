import { getTranslations } from 'next-intl/server'
import { Skeleton, SkeletonText } from '@/components/ui/skeleton'

/**
 * Placeholder shapes while a dashboard page streams in. `overview` mirrors the
 * brand Overview (header, three stat cards, a wide panel); `list` mirrors the
 * list pages (title, filters, rows). The shimmer stops under reduced motion.
 */
export async function DashboardSkeleton({ variant }: { variant: 'overview' | 'list' }) {
  const t = await getTranslations('dashboard.states')
  return (
    <main role="status" aria-busy="true" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <span className="sr-only">{t('loading')}</span>
      <div aria-hidden="true" className="space-y-6">
        <div className="space-y-3">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        {variant === 'overview' ? (
          <>
            <Skeleton className="h-24 w-full rounded-2xl" />
            <div className="grid gap-4 sm:grid-cols-3">
              {[0, 1, 2].map(i => (
                <div key={i} className="space-y-3 rounded-xl border border-border p-5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-8 w-16" />
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-border p-6"><SkeletonText lines={4} /></div>
          </>
        ) : (
          <>
            <div className="flex gap-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-9 w-24 rounded-full" />)}</div>
            <div className="divide-y divide-border rounded-2xl border border-border">
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="flex items-center gap-3 px-4 py-4">
                  <div className="flex-1 space-y-2"><Skeleton className="h-4 w-3/5" /><Skeleton className="h-3 w-1/4" /></div>
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
