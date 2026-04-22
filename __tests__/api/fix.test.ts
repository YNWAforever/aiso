import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockImplementation(() => ({
      select:      vi.fn().mockReturnThis(),
      eq:          vi.fn().mockReturnThis(),
      insert:      vi.fn().mockResolvedValue({ error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single:      vi.fn().mockResolvedValue({
        data: {
          id: 'scan-1', url: 'https://example.com', domain: 'example.com',
          results: { c2_llms_txt: { status: 'fail', message: 'llms_txt_missing' } },
        },
        error: null,
      }),
    })),
  },
}))

vi.mock('@/lib/openrouter', () => ({
  callOpenRouter: vi.fn().mockResolvedValue('{"llms_txt":"# About","robots_patch":"Allow: /","faq_schema":"{}"}'),
}))

vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  text: async () => '<title>Example</title>',
}))

import { parseFixPack } from '@/app/api/fix/route'

describe('parseFixPack', () => {
  it('extracts JSON from LLM response with leading text', () => {
    const raw = 'Here is the fix: {"llms_txt":"hello","robots_patch":"x","faq_schema":"y"}'
    expect(parseFixPack(raw)).toEqual({ llms_txt: 'hello', robots_patch: 'x', faq_schema: 'y' })
  })

  it('handles clean JSON response', () => {
    const raw = '{"llms_txt":"a","robots_patch":"b","faq_schema":"c"}'
    expect(parseFixPack(raw)).toEqual({ llms_txt: 'a', robots_patch: 'b', faq_schema: 'c' })
  })
})
