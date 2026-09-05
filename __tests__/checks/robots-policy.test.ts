import { describe, expect, it, vi } from 'vitest'
import { evaluateRobotsPolicy, AI_CRAWLER_ROLES } from '@/lib/robots-policy'
import { checkRobots } from '@/lib/checks/robots'

describe('robots path and group semantics', () => {
  it.each([
    ['User-agent: *\nDisallow: /', '/', false],
    ['User-agent: GPTBot\nDisallow: /private', '/', true],
    ['User-agent: GPTBot\nDisallow: /\nAllow: /$', '/', true],
    ['User-agent: GPTBot\nDisallow: /\nAllow: /$', '/private', false],
    ['User-agent: GPTBot\nDisallow: /*.pdf$', '/guide.pdf', false],
    ['User-agent: GPTBot\nDisallow: /*.pdf$', '/guide.pdfx', true],
    ['User-agent: GPTBot\nDisallow: /Private', '/private', true],
    ['User-agent: GPTBot\nDisallow: /x\nAllow: /x', '/x', true],
    ['User-agent: GPTBot\nDisallow: /x\nAllow: /x/public', '/x/public/y', true],
    ['User-agent: *\nDisallow: /\nUser-agent: GPTBot\nDisallow:', '/', true],
    ['Disallow: /\nUser-agent: GPTBot\nAllow: /', '/', true],
    ['USER-AGENT : gPtBoT # comment\nDISALLOW:/', '/', false],
    ['User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /', '/', false],
    ['User-agent: GPTBot\nAllow: /\nUser-agent: GPTBot\nDisallow: /private', '/private', false],
    ['User-agent: GPTBot-News\nDisallow: /', '/', true],
    ['User-agent: GPTBot\nDisallow: /%7Eprivate', '/~private', false],
    ['User-agent: GPTBot\nDisallow: /a%2Fb', '/a/b', true],
    ['User-agent: GPTBot\nDisallow: /魚', '/%E9%AD%9A', false],
    ['User-agent: GPTBot\nDisallow: /file%2A', '/file*', false],
    ['User-agent: GPTBot\nDisallow: /file%24', '/file$', false],
    ['User-agent: *\nDisallow: /', '/robots.txt', true],
    ['User-agent: GPTBot\nAllow: /page\nDisallow: /*.htm', '/page.htm', false],
    ['User-agent: GPTBot\nAllow: /\nDisallow: /$', '/', false],
    ['User-agent: GPTBot\nDisallow: *', '/', false],
    ['User-agent: GPTBot\nDisallow: *.gif$', '/photo.gif', false],
  ])('evaluates %s at %s', (text, path, allowed) => {
    expect(evaluateRobotsPolicy(text, 'GPTBot', path).allowed).toBe(allowed)
  })

  it('distinguishes documented bot roles without assuming user fetch enforcement', () => {
    expect(AI_CRAWLER_ROLES.find(x => x.token === 'OAI-SearchBot')?.role).toBe('search')
    expect(AI_CRAWLER_ROLES.find(x => x.token === 'GPTBot')?.role).toBe('training')
    expect(AI_CRAWLER_ROLES.find(x => x.token === 'ChatGPT-User')?.automatic).toBe(false)
    expect(AI_CRAWLER_ROLES.find(x => x.token === 'Google-Extended')?.role).toBe('control')
  })

  it('generic disallow blocks the evaluated root', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('User-agent: *\nDisallow: /'))
    expect(await checkRobots('https://example.com', fetcher)).toMatchObject({ status: 'fail', message: 'robots_ai_blocked' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('a private subpath prohibition is not a root prohibition', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('User-agent: GPTBot\nDisallow: /private'))
    expect(await checkRobots('https://example.com', fetcher)).toMatchObject({ status: 'pass', message: 'robots_ai_allowed' })
  })

  it('does not mistake user-requested retrieval policy for automatic crawler blocking', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('User-agent: ChatGPT-User\nDisallow: /'))
    expect(await checkRobots('https://example.com', fetcher)).toMatchObject({ status: 'warn', message: 'robots_no_ai_rules' })
  })
})
