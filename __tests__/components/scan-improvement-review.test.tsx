import { expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { VersionDetails } from '@/components/change-sets/VersionDetails'
import { VersionWorkspace } from '@/components/change-sets/VersionWorkspace'
import { DecisionForm } from '@/components/change-sets/DecisionForm'
import { draft, clientId } from './c9c-fixtures'
import { version } from './c9d-fixtures'
import { scanSuggestion } from './c9c-fixtures'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

it.each(['en', 'zh-HK'])('review renders retained source evidence for the existing multi-source version format in %s', lang => {
  if (version.schemaVersion !== 1) throw new Error('Single-source fixture required')
  if (scanSuggestion.evidence.kind !== 'scan-check') throw new Error('Scan evidence fixture required')
  const { evidenceSnapshot, ...common } = version
  const snapshot = { ...evidenceSnapshot, source: scanSuggestion.source, evidence: scanSuggestion.evidence }
  const html = renderToString(<NextIntlClientProvider locale={lang} timeZone="UTC" messages={lang === 'en' ? en : zh}>
    <VersionDetails version={{ ...common, schemaVersion: 2, evidenceSnapshots: [snapshot] }} latestVersionId={version.id} />
  </NextIntlClientProvider>)
  expect(html).toContain('c1_robots')
  expect(html).toContain('https://example.test')
  expect(html).toContain('2026-09-02T10:00:00.000Z')
  expect(html).not.toContain((lang === 'en' ? en : zh).changeSets.evidenceUnsupportedVersion)
})
it('version history returns to a live scan attachment when the original snapshot belongs elsewhere', () => {
  const selected='88888888-8888-4888-8888-888888888888'
  const html=renderToString(<NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
    <VersionWorkspace clientId={clientId} workItemId={draft.id} initialDraft={{...draft,sourceScanIds:[selected]}} initial={null}/>
  </NextIntlClientProvider>)
  expect(html).toContain(`step=improve&amp;scanId=${selected}&amp;draft=${draft.id}`)
})
it.each(['en', 'zh-HK'] as const)(
  'does not preselect approval or record a decision without an explicit choice in %s',
  lang => {
    const copy = (lang === 'en' ? en : zh).changeSets
    const html = renderToString(
      <NextIntlClientProvider locale={lang} messages={lang === 'en' ? en : zh} timeZone="UTC">
        <DecisionForm
          endpoint="/api/synthetic/decision"
          version={{ ...version, capabilities: { canDecide: true } }}
          onCompleted={() => undefined}
          onDirty={() => undefined}
        />
      </NextIntlClientProvider>,
    )
    expect(html).toContain(`<option value="" disabled="" selected="">${copy.decisionPlaceholder}</option>`)
    expect(html).not.toMatch(/<option value="approved" selected=""/)
  },
)
