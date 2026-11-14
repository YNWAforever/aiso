import { describe, expect, it, vi } from 'vitest'
import { freezeMultiSourceReview } from '@/lib/change-sets/validation'
import type { DraftSnapshotV1 } from '@/lib/opportunities/types'
import type { VersionDetail } from '@/lib/change-sets/types'
import { scanSuggestion } from './c9c-fixtures'
vi.mock('server-only', () => ({}))
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { VersionWorkspace } from '@/components/change-sets/VersionWorkspace'
import { VersionDetails } from '@/components/change-sets/VersionDetails'
import { DraftEditor } from '@/components/work-items/DraftEditor'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { draft, clientId, version, initial } from './c9d-fixtures'
const render = (node: React.ReactNode, lang = 'en') =>
  renderToString(
    <NextIntlClientProvider
      locale={lang}
      messages={lang === 'en' ? en : zh}
      timeZone="UTC"
    >
      {node}
    </NextIntlClientProvider>,
  )
describe('change set rendering', () => {
  it.each(['en', 'zh-HK'])('SME starts with no selected decision and keeps the full source accessible in %s', lang => {
    const copy = (lang === 'en' ? en : zh).changeSets
    const html = render(<VersionWorkspace clientId={clientId} workItemId={draft.id} initialDraft={draft} initial={initial} initialVersion={version} smeCopilot />, lang)
    expect(html).toContain('value="" selected=""')
    expect(html).toContain(copy.sme.chooseDecision)
    expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>${copy.recordDecision}</button>`))
    expect(html).toContain(renderToString(<>{copy.sme.independentReview}</>))
    expect(html).toContain(copy.sme.frozenSources)
    expect(html).toContain(copy.sme.frozenTechnical)
    const snapshot = version.schemaVersion === 1 ? version.evidenceSnapshot : version.evidenceSnapshots[0]
    expect(html).toContain(snapshot.evidence.kind === 'pulse-metric' ? snapshot.evidence.answerDigest : snapshot.evidence.comparisonSignature)
    expect(html).not.toContain('<script>')
    const legacy = render(<VersionWorkspace clientId={clientId} workItemId={draft.id} initialDraft={draft} initial={initial} initialVersion={version} />, lang)
    expect(legacy).toContain('value="approved" selected=""')
    expect(legacy).not.toContain(copy.sme.chooseDecision)
  })

  it.each(['en', 'zh-HK'])('retains the saved draft when SME history is unavailable without offering a freeze', lang => {
    const copy = (lang === 'en' ? en : zh).changeSets
    const html = render(<VersionWorkspace {...smeUnavailableProps} />, lang)
    expect(html).toContain(draft.title)
    expect(html).toContain(copy.unavailable)
    expect(html).toContain(copy.reloadHistory)
    expect(html).not.toContain(copy.submitVersion)
    expect(html).not.toContain(copy.noVersions)
    expect(html).not.toContain(copy.draftUnavailable)
  })
  it.each(['approved', 'changes_requested'] as const)('guides from fresher terminal %s detail, not stale pending summary', decision => {
    for (const lang of ['en', 'zh-HK']) {
      const copy = (lang === 'en' ? en : zh).changeSets
      const props = decision === 'approved' ? smeTerminalProps : smeChangesProps
      const html = render(<VersionWorkspace {...props} />, lang)
      expect(html).toContain(decision === 'approved' ? copy.sme.approved : copy.sme.revise)
      expect(html).not.toContain(copy.sme.wait)
      expect(html).not.toContain(copy.recordDecision)
      expect(html).toContain('Fresh terminal detail')
      if (decision === 'changes_requested') expect(html).toContain(`href="/${lang}/dashboard/${clientId}/opportunities?draft=${draft.id}"`)
    }
  })
  it.each(['en', 'zh-HK'])('renders every genuinely frozen V2 source in saved order, including duplicates, in %s', lang => {
    const copy = (lang === 'en' ? en : zh).changeSets
    expect(v2Version.contentHash).toBe(frozenV2.contentHash)
    expect(v2Version.schemaVersion).toBe(2)
    for (const smeCopilot of [false, true]) {
      const html = render(<VersionDetails version={v2Version} latestVersionId={v2Version.id} smeCopilot={smeCopilot} />, lang)
      const label = (number: number) => `aria-label="${copy.sme.sourceNumber.replace('{number}', String(number))}"`
      expect(html.indexOf(label(1))).toBeLessThan(html.indexOf(label(2)))
      expect(html.indexOf(label(2))).toBeLessThan(html.indexOf(label(3)))
      expect(html.match(/Original title/g)).toHaveLength(4)
      expect(html).toContain('Saved scan &lt;script&gt;source&lt;/script&gt;')
      expect(html).toContain('comparisonSignature')
      expect(html).toContain('answerDigest')
      expect(html).toContain('collection-time-unrecorded')
      expect(html).toContain(v2Version.contentHash)
      expect(html).not.toContain(copy.evidenceUnsupportedVersion)
      expect(html).not.toContain('<script>')
    }
  })
  it.each(['en', 'zh-HK'])(
    'shows persisted draft submission and immutable package separately in %s',
    (lang) => {
      const html = render(
        <VersionWorkspace
          clientId={clientId}
          workItemId={draft.id}
          initialDraft={draft}
          initial={initial}
          initialVersion={version}
        />,
        lang,
      )
      expect(html).toContain(
        'Frozen &lt;script&gt;alert(1)&lt;/script&gt; 版本',
      )
      expect(html).toContain('Recorded title')
      expect(html).not.toContain('<script>')
      expect(html).toContain('change-set-review.v1')
      expect(html).toContain('type="submit"')
    },
  )
  it('never offers submission without a persisted draft', () => {
    const html = render(
      <VersionWorkspace
        clientId={clientId}
        workItemId={draft.id}
        initialDraft={null}
        initial={null}
        initialError="unavailable"
      />,
    )
    expect(html).toContain('role="alert"')
    expect(html).not.toContain('type="submit"')
  })
  it.each(['self', 'revoked', 'non-approver'])(
    'does not offer decisions when API denies %s',
    () => {
      const html = render(
        <VersionDetails
          version={{ ...version, capabilities: { canDecide: false } }}
          latestVersionId={version.id}
        />,
      )
      expect(html).not.toContain('textarea')
      expect(html).toContain('independent')
    },
  )
  it('marks superseded immutable content', () => {
    const html = render(
      <VersionDetails version={version} latestVersionId="new" />,
    )
    expect(html).toContain('Superseded')
    expect(html).toContain('Frozen notes')
  })
  it('saved editor links to version history', () =>
    expect(
      render(
        <DraftEditor clientId={clientId} item={draft} onSaved={() => {}} />,
      ),
    ).toContain(`/en/dashboard/${clientId}/work-items/${draft.id}/versions`))
})

import { afterAll } from 'vitest'
import { writeC9cFixture } from './c9c-fixture-writer'
const fixtureProps = {
  clientId,
  workItemId: draft.id,
  initialDraft: draft,
  initial,
  initialVersion: version,
}
const unavailableProps = {
  ...fixtureProps,
  initialDraft: null,
  initial: null,
  initialVersion: null,
  initialError: 'unavailable',
}
const selectionProps = {
  ...fixtureProps,
  initialVersion: { ...version, versionNumber: 2 },
  initial: {
    ...initial,
    versions: [
      { ...version, versionNumber: 2 },
      {
        ...version,
        id: '66666666-6666-4666-8666-666666666666',
        capabilities: { canDecide: false },
      },
    ],
  },
}
const revokedProps = {
  ...fixtureProps,
  initialVersion: { ...version, capabilities: { canDecide: false } },
}
const smeProps = { ...fixtureProps, smeCopilot: true }
const guidanceViewer = 'abcdefab-cdef-4abc-8def-abcdefabcdef'
const blockedReview = { ...version, capabilities: { canDecide: false } }
const guidanceProps = { ...smeProps, viewerProfileId: guidanceViewer, initialVersion: blockedReview, initial: { ...initial, versions: [blockedReview] } }
const guidanceCapableProps = { ...smeProps, viewerProfileId: guidanceViewer }
const guidanceNewerProps = { ...guidanceProps, initialDraft: { ...draft, revision: 2 } }
const smeUnavailableProps = { ...unavailableProps, initialDraft: draft, smeCopilot: true }
function terminalProps(decision: 'approved' | 'changes_requested') {
  return { ...smeProps, initialVersion: { ...version, decision: { decision, reason: 'Fresh terminal detail', decidedAt: '2026-09-07T00:00:00.123456Z', decidedBy: { profileId: '88888888-8888-4888-8888-888888888888', displayName: 'Independent reviewer', role: 'account_approver' as const } }, capabilities: { canDecide: false } } }
}
const smeTerminalProps = terminalProps('approved'), smeChangesProps = terminalProps('changes_requested')
const smeEmptyProps = { ...smeProps, initialVersion: null, initial: { versions: [], nextCursor: null, latestVersionId: null } }
const smeNewerProps = { ...smeProps, initialDraft: { ...draft, revision: 2, title: 'Newer saved draft, not the frozen review' } }
const smeHistoricalProps = {
  ...smeProps,
  initial: { ...initial, latestVersionId: '66666666-6666-4666-8666-666666666666', versions: [version, { ...version, id: '66666666-6666-4666-8666-666666666666', versionNumber: 2, draftRevision: 2 }] },
}
// Freeze only in Node test setup. Hydration receives these actual JSON props;
// no validation/server-only/crypto module enters the client fixture bundle.
if (scanSuggestion.evidence.kind !== 'scan-check') throw Error('Expected saved scan fixture')
const scanSnapshot: DraftSnapshotV1 = {
  schemaVersion: 1, source: scanSuggestion.source, ruleVersion: scanSuggestion.ruleVersion,
  evidence: scanSuggestion.evidence, limitations: scanSuggestion.limitations,
  titleKey: scanSuggestion.titleKey, actionKey: scanSuggestion.actionKey, args: scanSuggestion.args,
  locale: 'zh-HK', initialTitle: 'Saved scan <script>source</script>', initialAction: 'Inspect the saved scan only.',
}
const v2Draft = { ...draft, revision: 2, title: 'Frozen mixed-source review', action: 'Review all three saved sources.', notes: 'Saved 中文\tV2\nNo live collection.' }
// The legacy C9C transport fixture deliberately has different wrapper limits.
// A real stored review requires the wrapper to retain the evidence's limits.
const pulseSnapshot = { ...draft.evidenceSnapshot, limitations: [...draft.evidenceSnapshot.evidence.limitations] }
const frozenV2 = freezeMultiSourceReview(v2Draft, [scanSnapshot, pulseSnapshot, pulseSnapshot])
const v2Version: VersionDetail = {
  ...frozenV2.content, id: '77777777-7777-4777-8777-777777777777', versionNumber: 2,
  contentHash: frozenV2.contentHash, validation: frozenV2.validation,
  submittedBy: version.submittedBy, submittedAt: '2026-09-06T00:00:00.123456Z', decision: null, capabilities: { canDecide: true },
}
const smeV2Props = { ...smeProps, initialDraft: v2Draft, initialVersion: v2Version, initial: { versions: [version, v2Version], nextCursor: null, latestVersionId: v2Version.id } }
const guidanceV2Props = { ...smeV2Props, viewerProfileId: guidanceViewer, initialVersion: { ...v2Version, capabilities: { canDecide: false } }, initial: { ...smeV2Props.initial, versions: smeV2Props.initial.versions.map(value => ({ ...value, capabilities: { canDecide: false } })) } }
afterAll(() =>
  writeC9cFixture(
    'C9D',
    'VersionWorkspaceFixture',
    '@/__tests__/components/c9d-workspace-fixture',
    fixtureProps,
    (lang) => render(<VersionWorkspace {...fixtureProps} />, lang),
    {
      selection: {
        props: selectionProps,
        html: (lang) => render(<VersionWorkspace {...selectionProps} />, lang),
      },
      unavailable: {
        props: unavailableProps,
        html: (lang) =>
          render(<VersionWorkspace {...unavailableProps} />, lang),
      },
      revoked: {
        props: revokedProps,
        html: (lang) => render(<VersionWorkspace {...revokedProps} />, lang),
      },
      guidance: { props: guidanceProps, html: lang => render(<VersionWorkspace {...guidanceProps} />, lang) },
      guidanceCapable: { props: guidanceCapableProps, html: lang => render(<VersionWorkspace {...guidanceCapableProps} />, lang) },
      guidanceNewer: { props: guidanceNewerProps, html: lang => render(<VersionWorkspace {...guidanceNewerProps} />, lang) },
      guidanceV2: { props: guidanceV2Props, html: lang => render(<VersionWorkspace {...guidanceV2Props} />, lang) },
      sme: { props: smeProps, html: lang => render(<VersionWorkspace {...smeProps} />, lang) },
      smeTerminal: { props: smeTerminalProps, html: lang => render(<VersionWorkspace {...smeTerminalProps} />, lang) },
      smeChanges: { props: smeChangesProps, html: lang => render(<VersionWorkspace {...smeChangesProps} />, lang) },
      smeEmpty: { props: smeEmptyProps, html: lang => render(<VersionWorkspace {...smeEmptyProps} />, lang) },
      smeNewer: { props: smeNewerProps, html: lang => render(<VersionWorkspace {...smeNewerProps} />, lang) },
      smeHistorical: { props: smeHistoricalProps, html: lang => render(<VersionWorkspace {...smeHistoricalProps} />, lang) },
      smeV2: { props: smeV2Props, html: lang => render(<VersionWorkspace {...smeV2Props} />, lang) },
      smeRevoked: { props: { ...revokedProps, smeCopilot: true }, html: lang => render(<VersionWorkspace {...revokedProps} smeCopilot />, lang) },
      smeUnavailable: { props: smeUnavailableProps, html: lang => render(<VersionWorkspace {...smeUnavailableProps} />, lang) },
    },
    'changeSets',
  ),
)
