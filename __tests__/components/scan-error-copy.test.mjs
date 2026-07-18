import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

async function loadMessages(locale) {
  return JSON.parse(await readFile(new URL(`../../messages/${locale}.json`, import.meta.url), 'utf8'))
}

describe('scan failure copy', () => {
  it('does not blame a valid URL for an unavailable scan service', async () => {
    const [english, cantonese] = await Promise.all([loadMessages('en'), loadMessages('zh-HK')])

    expect(english.home.scan_error_action).toBe(
      'We could not complete the scan. Please try again shortly.',
    )
    expect(cantonese.home.scan_error_action).toBe('暫時未能完成掃描，請稍後再試。')
  })
})
