'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import type { ReportFindingCandidate } from '@/lib/reports/finding-candidates'
import type { WorkItem } from '@/lib/work-items/schema'
import type { WorkVerificationObservation } from '@/lib/work-items/verification'
import { DraftEditor } from '@/components/work-items/DraftEditor'

export type ReportImprovementFinding = ReportFindingCandidate & {
  existingTask: WorkItem | null
}

type FindingsState = 'ok' | 'empty' | 'unavailable'

export function ReportImprovementTasks({
  clientId,
  brandName,
  domain,
  reportId,
  reportVersionId,
  reportVersionNumber,
  latestVersionNumber,
  locale,
  findingsState,
  findings,
  verificationObservations,
}: {
  clientId: string
  brandName: string
  domain: string
  reportId: string
  reportVersionId: string
  reportVersionNumber: number
  latestVersionNumber: number
  locale: 'en' | 'zh-HK'
  findingsState: FindingsState
  findings: ReportImprovementFinding[]
  verificationObservations?: WorkVerificationObservation[]
}) {
  const t = useTranslations('reports')
  const [currentLatest, setCurrentLatest] = useState(latestVersionNumber)
  const [freshness, setFreshness] = useState<'checking' | 'ok' | 'unavailable'>('checking')
  const [selected, setSelected] = useState<WorkItem | null>(null)
  const [tasksByKey, setTasksByKey] = useState<Record<string, WorkItem>>({})
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'warning'; key?: string; text: string } | null>(null)
  const lock = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 15_000)
    let active = true
    fetch(`/api/clients/${encodeURIComponent(clientId)}/reports`, {
      cache: 'no-store',
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error()
      const body = await response.json() as { reports?: unknown }
      if (!Array.isArray(body.reports)) throw new Error()
      const report = body.reports.find((item): item is { id: string; latestVersionNumber: number } =>
        Boolean(item && typeof item === 'object'
          && (item as { id?: unknown }).id === reportId
          && Number.isSafeInteger((item as { latestVersionNumber?: unknown }).latestVersionNumber)))
      if (!report) throw new Error()
      if (active) {
        setCurrentLatest(report.latestVersionNumber)
        setFreshness('ok')
      }
    }).catch(() => {
      if (active) setFreshness('unavailable')
    }).finally(() => window.clearTimeout(timer))
    return () => {
      active = false
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [clientId, reportId])

  async function createOrOpen(finding: ReportImprovementFinding) {
    if (lock.current) return
    const existingTask = finding.existingTask ?? tasksByKey[finding.checkKey]
    if (existingTask) {
      setSelected(existingTask)
      return
    }
    lock.current = true
    setPendingKey(finding.checkKey)
    setNotice(null)
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/work-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: finding.source,
          ruleVersion: finding.ruleVersion,
          fingerprint: finding.fingerprint,
          locale,
          reportVersionId,
        }),
        signal: AbortSignal.timeout(15_000),
      })
      const body = await response.json() as { item?: WorkItem }
      if (!response.ok || !body.item || body.item.clientId !== clientId) throw new Error()
      setTasksByKey(tasks => ({ ...tasks, [finding.checkKey]: body.item! }))
      setSelected(body.item)
      setNotice({
        kind: response.status === 201 ? 'success' : 'warning',
        key: finding.checkKey,
        text: t(response.status === 201 ? 'findings_task_created' : 'findings_task_reused'),
      })
    } catch {
      setNotice({ kind: 'error', key: finding.checkKey, text: t('findings_task_error') })
    } finally {
      lock.current = false
      setPendingKey(null)
    }
  }

  const newer = currentLatest > reportVersionNumber
  return (
    <section className="mt-8 space-y-5" aria-label={t('findings_title')}>
      <div>
        <h2 className="text-xl font-bold tracking-tight">{t('findings_title')}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{t('findings_body')}</p>
      </div>
      {newer && (
        <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <h3 className="font-semibold">{t('findings_newer_title')}</h3>
          <p className="mt-1">{t('findings_newer_body', { current: currentLatest, selected: reportVersionNumber })}</p>
          <Link className="mt-3 inline-flex min-h-11 items-center underline" href={`/${locale}/dashboard/${encodeURIComponent(clientId)}/reports/${encodeURIComponent(reportId)}`}>
            {t('findings_review_latest')}
          </Link>
        </div>
      )}
      {freshness === 'unavailable' && (
        <p role="status" className="text-sm text-muted-foreground">{t('findings_freshness_unavailable')}</p>
      )}
      {findingsState === 'unavailable' && <p role="alert">{t('findings_unavailable')}</p>}
      {findingsState === 'empty' && <p>{t('findings_empty')}</p>}
      {findingsState === 'ok' && (
        <div className="space-y-4">
          {findings.map(finding => {
            const existingTask = finding.existingTask ?? tasksByKey[finding.checkKey] ?? null
            return <article key={finding.checkKey} data-finding-key={finding.checkKey} className="rounded-xl border border-border bg-card p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('findings_priority', { rank: finding.rank, impact: finding.expectedImpact })}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold">{finding.title}</h3>
                  <p className="text-sm text-muted-foreground">{brandName} · {domain} · {finding.checkKey}</p>
                </div>
                <span className="rounded-full border px-3 py-1 text-xs font-semibold">
                  {t('findings_report_version', { version: reportVersionNumber })}
                </span>
              </div>
              <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-semibold">{t('findings_problem')}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words">{finding.rationale}</dd>
                </div>
                <div>
                  <dt className="font-semibold">{t('findings_action')}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words">{finding.nextStep}</dd>
                </div>
                <div>
                  <dt className="font-semibold">{t('findings_target')}</dt>
                  <dd className="mt-1 break-all">{finding.targetUrl ?? t('findings_target_missing')}</dd>
                  <p className="mt-1 text-xs text-muted-foreground">{t('findings_target_unconfirmed')}</p>
                </div>
                <div>
                  <dt className="font-semibold">{t('findings_source')}</dt>
                  <dd className="mt-1 space-y-1">
                    {finding.observations.length
                      ? finding.observations.map((observation, index) => (
                        <p key={`${observation.observedAt ?? 'unknown'}:${index}`}>
                          {observation.observedAt ?? t('findings_time_unknown')}
                          {' · '}
                          {observation.target.origin ?? t('findings_target_missing')}
                          {observation.httpStatus === null ? '' : ` · HTTP ${observation.httpStatus}`}
                        </p>
                      ))
                      : <p>{t('findings_no_observation')}</p>}
                  </dd>
                </div>
              </dl>
              <p className="mt-4 text-xs leading-5 text-muted-foreground">{t('findings_evidence_limit')}</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="min-h-11 rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-50"
                  disabled={pendingKey !== null}
                  onClick={() => void createOrOpen(finding)}
                >
                  {pendingKey === finding.checkKey
                    ? t('findings_creating')
                    : existingTask ? t('findings_open_task') : t('findings_create_task')}
                </button>
                {existingTask && !existingTask.evidenceSnapshot.reportProvenance && (
                  <p className="text-sm text-muted-foreground">{t('findings_existing_legacy')}</p>
                )}
                {notice?.key === finding.checkKey && (
                  <p role={notice.kind === 'error' ? 'alert' : 'status'} className="text-sm">{notice.text}</p>
                )}
              </div>
            </article>
          })}
        </div>
      )}
      {selected && (
        <div className="pt-2">
          <DraftEditor
            key={selected.id}
            clientId={clientId}
            scanId={findingSourceScan(selected)}
            item={selected}
            onSaved={item => {
              setSelected(item)
              if (item.evidenceSnapshot.source.kind === 'scan-check') {
                const key = item.evidenceSnapshot.source.checkKey
                if (key) setTasksByKey(tasks => ({ ...tasks, [key]: item }))
              }
            }}
            verificationObservations={verificationObservations}
          />
        </div>
      )}
    </section>
  )
}

function findingSourceScan(item: WorkItem): string | undefined {
  return item.evidenceSnapshot.source.kind === 'scan-check'
    ? item.evidenceSnapshot.source.id : undefined
}
