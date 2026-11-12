import { describe, expect, it } from 'vitest'
import { StudioConnectAssistant } from '@/components/dashboard/StudioConnectAssistant'
import { renderWithIntl } from '@/__tests__/helpers/intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

describe('StudioConnectAssistant', () => {
  it.each(['en', 'zh-HK'])('explains the read-only assistant before minting anything in %s', lang => {
    const copy = (lang === 'en' ? en : zh).conversationStudio.connectAssistant
    const html = renderWithIntl(<StudioConnectAssistant clientId="11111111-1111-4111-8111-111111111111" />, lang)
    expect(html).toContain(copy.title)
    expect(html).toContain(copy.body.replace(/'/g, '&#x27;'))
    expect(html).toContain(copy.readOnly)
    expect(html).toContain(copy.mint)
    // No token is minted on render; only an explicit click calls the session endpoint.
    expect(html).not.toContain('v1.')
    expect(html).not.toContain(copy.copy)
  })
})
