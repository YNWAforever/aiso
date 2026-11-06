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
      {version.editSpec?.kind === 'llms_txt' ? (
        // Site-edit S10: the exact llms.txt this version's approval covers.
        <section className="space-y-2 rounded-lg border border-border p-3" aria-label={t('editSpecLlmsTxtTitle')}>
          <h3 className="font-semibold">{t('editSpecLlmsTxtTitle')}</h3>
          <p className="break-all">{version.editSpec.targetUrl}</p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-sm" tabIndex={0}>
            {version.editSpec.content}
          </pre>
        </section>
      ) : version.editSpec?.kind === 'meta' ? (
        // Site-edit S9: the exact page title/description this version's approval covers.
        <section className="space-y-2 rounded-lg border border-border p-3" aria-label={t('editSpecMetaTitle')}>
          <h3 className="font-semibold">{t('editSpecMetaTitle')}</h3>
          <p className="break-all">{version.editSpec.targetUrl}</p>
          <dl className="space-y-1">
            <dt className="text-sm">{t('editSpecPageTitle')}</dt>
            <dd className="break-words">{version.editSpec.title ?? t('editSpecUnchanged')}</dd>
            <dt className="text-sm">{t('editSpecDescription')}</dt>
            <dd className="break-words">{version.editSpec.description ?? t('editSpecUnchanged')}</dd>
          </dl>
        </section>
      ) : version.editSpec && (
        // Site-edit S1: the exact JSON-LD this version's approval covers.
        <section className="space-y-2 rounded-lg border border-border p-3" aria-label={t('editSpecTitle')}>
          <h3 className="font-semibold">{t(version.editSpec.kind === 'jsonld_remove' ? 'editSpecRemoveTitle' : 'editSpecTitle')}</h3>
          <p>{version.editSpec.schemaType} · <span className="break-all">{version.editSpec.targetUrl}</span></p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-sm" tabIndex={0}>
            {JSON.stringify(version.editSpec.payload, null, 2)}
          </pre>
        </section>
      )}
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
      {version.schemaVersion === 1 ? (
        <EvidenceDetails
          evidence={version.evidenceSnapshot.evidence}
          limitations={version.evidenceSnapshot.limitations}
        />
      ) : (
        // schemaVersion 2 (051, multi-source): not yet rendered here. Stated
        // honestly rather than crashing on evidenceSnapshot, which this
        // version does not have -- it has evidenceSnapshots, plural.
        <p>{t('evidenceUnsupportedVersion')}</p>
      )}
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
