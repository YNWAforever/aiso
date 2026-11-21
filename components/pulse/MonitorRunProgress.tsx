'use client'

import { useCallback, useRef, type ComponentProps } from 'react'
import { useRouter } from 'next/navigation'
import { RunProgress } from './RunProgress'
import type { CanonicalCoverage } from '@/lib/view-models/pulse'
import type { UserPulseRun } from '@/lib/pulse/runs/user-dispatch'

function coverageKey({ id, succeeded, classified, pending, failed, blocked }: CanonicalCoverage) {
  return [id, succeeded, classified, pending, failed, blocked].join(':')
}

export function MonitorRunProgress({ canonical, ...props }: Omit<ComponentProps<typeof RunProgress>, 'onCanonicalProgress'> & {
  canonical?: CanonicalCoverage
}) {
  const router = useRouter()
  const lastRequested = useRef<string | null>(null)
  const latestKey = canonical ? coverageKey(canonical) : null
  const latestWeek = canonical?.week
  const updateOverview = useCallback((run: UserPulseRun) => {
    if (latestWeek && run.week < latestWeek) return
    const key = coverageKey({ ...run.coverage, id: run.id, week: run.week })
    if (key === latestKey || key === lastRequested.current) return
    lastRequested.current = key
    router.refresh()
  }, [latestKey, latestWeek, router])
  return <RunProgress {...props} onCanonicalProgress={updateOverview} />
}
