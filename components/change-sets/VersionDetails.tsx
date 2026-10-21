'use client'
import { useTranslations } from 'next-intl'
import { EvidenceDetails } from '@/components/opportunities/EvidenceDetails'
import type { VersionDetail } from '@/lib/change-sets/types'
export function VersionDetails({
  version,
  latestVersionId,
}: {
  version: VersionDetail
  latestVersionId: string | null
}) {
  const t = useTranslations('changeSets')
  const work = useTranslations('opportunities')
  return (
    <section
      className="min-w-0 space-y-4 rounded-xl border border-border p-4"
      aria-label={t('versionDetails')}
    >
      <h2 className="text-xl font-semibold">
        {t('versionNumber', { number: version.versionNumber })}
      </h2>
      <p>{t('savedRevision', { revision: version.draftRevision })}</p>
      <p>{version.id}</p>
      {latestVersionId !== null && version.id !== latestVersionId && (
        <p>{t('superseded')}</p>
      )}
      <p>{t(version.decision?.decision ?? 'pending')}</p>
      <h3 className="whitespace-pre-wrap break-words font-semibold">
        {version.title}
      </h3>
      <p className="whitespace-pre-wrap break-words">{version.action}</p>
      <p className="whitespace-pre-wrap break-words">{version.notes}</p>
      <section className="space-y-3 rounded-lg border border-border p-4" aria-label={t('preparationTitle')}>
        <h3 className="font-semibold">{t('preparationTitle')}</h3>
        {version.preparation ? <>
          <p>{t('preparationFrozenNotice')}</p>
          <p className="font-semibold">{work('targetPageUnconfirmed')}</p>
          <dl className="space-y-2">
            <dt className="font-semibold">{work('targetUrl')}</dt>
            <dd className="break-all">{version.preparation.targetUrl ?? t('preparationNoTarget')}</dd>
            <dt className="font-semibold">{work('acceptanceCriteria')}</dt>
            <dd className="whitespace-pre-wrap break-words">{version.preparation.acceptanceCriteria || t('preparationNoCriteria')}</dd>
          </dl>
        </> : <p>{t('preparationLegacy')}</p>}
      </section>
      <p>
        {t('submittedBy')}:{' '}
        {version.submittedBy.displayName ?? version.submittedBy.profileId} ·{' '}
        {version.submittedAt}
      </p>
      <p>
        {t('packageChecks')}: {version.validation.policyVersion}
      </p>
      <ul>
        {version.validation.checks.map((check) => (
          <li key={check.code}>
            {t('check_' + check.code)} — {t('pass')}
          </li>
        ))}
      </ul>
      <p className="break-all">
        {t('contentHash')}: {version.contentHash}
      </p>
      {(version.schemaVersion === 1 ? [version.evidenceSnapshot] : version.evidenceSnapshots).map((snapshot, index) => (
        <EvidenceDetails
          key={index}
          evidence={snapshot.evidence}
          limitations={snapshot.limitations}
        />
      ))}
      {version.decision && (
        <div className="space-y-2">
          <p>
            {t('decidedBy')}:{' '}
            {version.decision.decidedBy.displayName ??
              version.decision.decidedBy.profileId}{' '}
            · {version.decision.decidedAt}
          </p>
          <p className="whitespace-pre-wrap break-words">
            {version.decision.reason}
          </p>
        </div>
      )}
      {!version.decision && !version.capabilities.canDecide && (
        <p>{t('denied')}</p>
      )}
    </section>
  )
}
