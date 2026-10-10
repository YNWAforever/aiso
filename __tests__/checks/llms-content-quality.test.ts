import { describe, expect, it, vi } from 'vitest'
import { checkLlmsFullTxt } from '@/lib/checks/llmsFullTxt'
import { computeImpact } from '@/lib/impact'
import { checkRobots } from '@/lib/checks/robots'

describe('T01 optional llms.txt content and crawler evidence', () => {
  it('markdown_links_are_counted without requesting llms-full.txt', async () => {
    const fetcher = vi.fn(async () => new Response('# Example\n> Summary\n## Pages\n- [One](https://example.test/one)\n- [Two](https://example.test/two)\n- [Three](https://example.test/three)\n'))
    const result = await checkLlmsFullTxt('https://example.test', fetcher)
    expect(result.status).toBe('pass')
    expect(result.details).toBe('3 URLs, 6 lines')
    expect(fetcher.mock.calls.length).toBe(1)
  })
  it('mixed relative, Markdown and bare URLs are resolved and deduplicated; unsafe schemes do not count', async () => {
    const fetcher = vi.fn(async () => new Response('# Example\n> Summary\n## Pages\n- [One](/one)\nhttps://example.test/one\n- [Two](https://example.test/two)\n- [Three](https://example.test/three)\n- [Unsafe](javascript:alert(1))'))
    expect((await checkLlmsFullTxt('https://example.test', fetcher)).details).toBe('3 URLs, 8 lines')
  })
  it('gptbot_block_does_not_block_search and consumer exposure remains unmeasured', async () => {
    const robots = await checkRobots('https://example.test', async () => new Response('User-agent: GPTBot\nDisallow: /\nUser-agent: OAI-SearchBot\nAllow: /'))
    const impact = computeImpact({ c1_robots: robots }, { score: 70 })
    expect(impact.platformVisibility.map(p => p.status)).toEqual(Array(5).fill('not_measured'))
    expect((robots as unknown as { collectorAccess: unknown[] }).collectorAccess).toEqual(expect.arrayContaining([
      expect.objectContaining({ crawler: 'GPTBot', role: 'training', policy: 'blocked', probe: 'not_measured' }),
      expect.objectContaining({ crawler: 'OAI-SearchBot', role: 'search', policy: 'allowed', probe: 'not_measured' }),
    ]))
  })
})
