import { describe, expect, it } from 'vitest'
import { groupThreads, matchesThread, relativeTime, threadGroup } from '@/lib/conversation-studio/thread-list'

const now = new Date(2026, 10, 3, 15, 0) // local 2026-11-03 15:00
const at = (days: number, hours = 0) => new Date(now.getTime() - days * 86400000 - hours * 3600000).toISOString()

describe('threadGroup', () => {
  it.each([
    [at(0, 1), 'today'],
    [new Date(2026, 10, 3, 0, 0).toISOString(), 'today'],
    [new Date(2026, 10, 2, 23, 59).toISOString(), 'week'],
    [at(6), 'week'],
    [at(8), 'older'],
    [undefined, 'unsaved'],
    ['not a date', 'unsaved'],
  ] as const)('%s → %s', (value, group) => {
    expect(threadGroup(value, now)).toBe(group)
  })
})

describe('groupThreads', () => {
  it('orders groups unsaved → today → week → older, keeps order inside each, and drops empty groups', () => {
    const threads = [
      { title: 'a', goal: '', updatedAt: at(0, 1) },
      { title: 'b', goal: '' },
      { title: 'c', goal: '', updatedAt: at(9) },
      { title: 'd', goal: '', updatedAt: at(0, 2) },
    ]
    expect(groupThreads(threads, now).map(group => [group.key, group.threads.map(thread => thread.title)])).toEqual([
      ['unsaved', ['b']], ['today', ['a', 'd']], ['older', ['c']],
    ])
  })
})

describe('matchesThread', () => {
  const thread = { title: 'Competitor gap for Sourdough', goal: '比較香港烘焙店' }
  it('matches title, goal and skill label, case- and width-insensitively', () => {
    expect(matchesThread(thread, '')).toBe(true)
    expect(matchesThread(thread, 'SOURDOUGH')).toBe(true)
    expect(matchesThread(thread, '烘焙')).toBe(true)
    expect(matchesThread(thread, 'ＧＡＰ')).toBe(true)
    expect(matchesThread(thread, 'report', 'Report')).toBe(true)
    expect(matchesThread(thread, 'missing')).toBe(false)
  })
})

describe('relativeTime', () => {
  it('formats in the viewer locale and is null when the time is unknown', () => {
    expect(relativeTime(at(0, 5), now, 'en')).toBe('5 hours ago')
    expect(relativeTime(at(0, 5), now, 'zh-HK')).toBe('5 小時前')
    expect(relativeTime(new Date(now.getTime() - 20000).toISOString(), now, 'en')).toBe('now')
    expect(relativeTime(undefined, now, 'en')).toBeNull()
  })
})
