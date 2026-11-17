import { describe, expect, it } from 'vitest'
import { STUDIO_HOME_TEMPLATES } from '@/lib/conversation-studio/home'
import { readStudioAsk, readStudioTask, studioTaskHref } from '@/lib/conversation-studio/task-handoff'

const clientId = '11111111-1111-4111-8111-111111111111'
const base = `/en/dashboard/${clientId}/studio`

describe('studio task handoff', () => {
  it('accepts only the known task vocabulary', () => {
    for (const task of STUDIO_HOME_TEMPLATES) expect(readStudioTask(task)).toBe(task)
    for (const value of ['', 'admin', 'PULSE', null, undefined, ['pulse']]) expect(readStudioTask(value)).toBeNull()
  })

  it('carries the task and a bounded question into Chat', () => {
    const href = studioTaskHref({ lang: 'en', clientId, task: 'pulse', ask: '  Why was this missed?  ' })
    expect(href).toBe(`${base}?ask=Why+was+this+missed%3F&task=pulse`)
  })

  it('drops an empty question and an unknown task instead of guessing', () => {
    expect(studioTaskHref({ lang: 'en', clientId, ask: '   ', task: 'not-a-task' as never })).toBe(base)
    expect(readStudioTask('not-a-task')).toBeNull()
  })

  it('keeps the question within the composer limit', () => {
    const ask = readStudioAsk('x'.repeat(1200))
    expect(ask).toHaveLength(1000)
    expect(studioTaskHref({ lang: 'en', clientId, task: 'pulse', ask })).toContain(`task=pulse`)
  })

  it('encodes both path and question components', () => {
    const href = studioTaskHref({ lang: 'zh-HK', clientId: 'brand & co', task: 'improve', ask: '點解？' })
    expect(href).toBe(`/zh-HK/dashboard/brand%20%26%20co/studio?ask=${encodeURIComponent('點解？')}&task=improve`)
  })
})
