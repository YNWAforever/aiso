'use client'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ScanTimeline, type TimelineCheck } from '@/components/visuals/ScanTimeline'
import { CHECK_SLOTS } from '@/lib/result/view-model'
import { progressStatus } from '@/lib/result/scan-progress'

/**
 * The live checklist that replaces a spinner while a scan runs. Loaded only
 * when a scan starts (ScanForm imports it with next/dynamic), so the landing
 * page ships no animation code for it.
 */
export default function ScanProgress({ score }: { score?: number | null }) {
  const names = useTranslations('checks')
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const start = performance.now()
    const id = window.setInterval(() => setElapsed(performance.now() - start), 250)
    return () => window.clearInterval(id)
  }, [])

  const checks: TimelineCheck[] = CHECK_SLOTS.map(slot => ({
    key: slot.key, label: names(slot.key), bucket: slot.bucket, status: progressStatus(slot.key, elapsed),
  }))
  return <ScanTimeline checks={checks} score={score} className="rounded-xl border border-border bg-neutral-1 p-4" />
}
