import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sql } = vi.hoisted(() => ({ sql: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => sql }))

import { TASK_LIMIT, listTasks, taskStatus } from '@/lib/tasks/list'

describe('taskStatus', () => {
  it.each([
    [{ versionId: null, decision: null, delivered: false }, 'draft'],
    [{ versionId: 'v1', decision: null, delivered: false }, 'in_review'],
    [{ versionId: 'v1', decision: 'changes_requested', delivered: false }, 'changes_requested'],
    [{ versionId: 'v1', decision: 'approved', delivered: false }, 'approved'],
    [{ versionId: 'v1', decision: 'approved', delivered: true }, 'delivered'],
    // A delivery event can only follow an approval; never let one skip review.
    [{ versionId: 'v1', decision: null, delivered: true }, 'in_review'],
  ] as const)('%o is %s', (input, status) => {
    expect(taskStatus(input)).toBe(status)
  })
})

describe('listTasks', () => {
  beforeEach(() => { sql.mockReset() })

  it('scopes the read to the account and brand, on every joined table', async () => {
    sql.mockResolvedValue([])
    await listTasks('acct-1', 'client-1')

    const [strings, ...values] = sql.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
    const text = strings.join('?')
    expect(values).toEqual(['acct-1', 'client-1', TASK_LIMIT])
    expect(text).toContain('where w.account_id = ? and w.client_id = ?')
    for (const alias of ['lv', 'd', 'e', 'x', 'le']) expect(text).toMatch(new RegExp(`${alias}\\.account_id = \\w+\\.account_id and ${alias}\\.client_id = \\w+\\.client_id`))
    // Submissions, decisions and deliveries do not touch w.updated_at.
    expect(text).toContain('order by greatest(w.updated_at, v.submitted_at, d.decided_at, de.recorded_at) desc')
    // Never `returning *`/`select *` across joins: duplicate column names collapse.
    expect(text).not.toContain('*')
  })

  it('maps rows to tasks with one status each', async () => {
    sql.mockResolvedValue([
      { id: 'w1', title: 'Add llms.txt', check_key: 'c2', updated_at: new Date('2026-10-01T00:00:00Z'), version_id: null, version_number: null, decision: null, delivered: false },
      { id: 'w2', title: 'Fix schema', check_key: null, updated_at: '2026-10-02T00:00:00.000Z', version_id: 'v2', version_number: 3, decision: 'approved', delivered: true },
    ])
    expect(await listTasks('acct-1', 'client-1')).toEqual([
      { id: 'w1', title: 'Add llms.txt', checkKey: 'c2', status: 'draft', versionNumber: null, updatedAt: '2026-10-01T00:00:00.000Z' },
      { id: 'w2', title: 'Fix schema', checkKey: null, status: 'delivered', versionNumber: 3, updatedAt: '2026-10-02T00:00:00.000Z' },
    ])
  })

  it('lets a database failure surface instead of reading as "no tasks"', async () => {
    sql.mockRejectedValue(new Error('connection terminated'))
    await expect(listTasks('acct-1', 'client-1')).rejects.toThrow('connection terminated')
  })
})
