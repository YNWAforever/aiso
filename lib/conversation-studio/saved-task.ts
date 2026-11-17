import 'server-only'
import { db } from '@/lib/db'
import { isConversationStudioEnabled } from '@/lib/flags'
import { parseStudioSkill, skillForTask, type StudioSkillId } from './skills'
import type { StudioHomeTemplate } from './home'

/**
 * The return path for a task card: the member's latest saved Studio discussion
 * for the exact same task. This is a read-only projection ??it never copies a
 * turn, starts a thread or re-composes an answer. A task without a registered
 * skill is simply empty, and an unreadable store stays explicit rather than
 * looking like "never asked".
 */
export type SavedTaskThread = {
  id: string
  title: string
  updatedAt: string
  turnCount: number
  skill: StudioSkillId | null
  visibility: 'private' | 'shared'
  mine: boolean
}

export type SavedTaskRead =
  | { state: 'ready'; thread: SavedTaskThread }
  | { state: 'empty' }
  | { state: 'unavailable' }

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const VISIBILITIES = new Set(['private', 'shared'])

function iso(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value
  return null
}

function savedThread(row: Record<string, unknown>, profileId: string): SavedTaskThread | null {
  const updatedAt = iso(row.updated_at)
  if (typeof row.id !== 'string' || typeof row.title !== 'string' || !updatedAt) return null
  const visibility = VISIBILITIES.has(String(row.visibility)) ? String(row.visibility) as 'private' | 'shared' : 'private'
  return {
    id: row.id,
    title: row.title,
    updatedAt,
    turnCount: Number(row.turn_count ?? 0),
    skill: parseStudioSkill(row.skill),
    visibility,
    mine: String(row.profile_id) === profileId,
  }
}

export async function loadSavedTaskThread(input: {
  accountId: string
  profileId: string
  clientId: string
  task: StudioHomeTemplate
}): Promise<SavedTaskRead> {
  if (!isConversationStudioEnabled(input.clientId) || !UUID.test(input.clientId)) return { state: 'empty' }
  const skill = skillForTask(input.task)
  if (!skill) return { state: 'empty' }
  try {
    const sql = db()
    const rows = await sql`
      select t.id, t.title, t.updated_at, t.profile_id, t.visibility, t.skill,
        (select count(*)::int from studio_thread_turns u
          where u.thread_id = t.id and u.account_id = t.account_id
            and u.client_id = t.client_id and u.profile_id = t.profile_id) as turn_count
      from studio_threads t
      where t.account_id = ${input.accountId}::uuid
        and t.client_id = ${input.clientId}::uuid
        and t.archived_at is null
        and (t.profile_id = ${input.profileId}::uuid or t.visibility = 'shared')
        and (
          t.skill = ${skill}
          or (t.skill is null and (select f.task from studio_thread_turns f
            where f.thread_id = t.id and f.account_id = t.account_id
              and f.client_id = t.client_id and f.profile_id = t.profile_id
            order by f.position limit 1) = ${input.task})
        )
        and exists (select 1 from studio_thread_turns u
          where u.thread_id = t.id and u.account_id = t.account_id
            and u.client_id = t.client_id and u.profile_id = t.profile_id)
      order by t.updated_at desc, t.id desc
      limit 1
    `
    const thread = rows[0] ? savedThread(rows[0] as Record<string, unknown>, input.profileId) : null
    return thread ? { state: 'ready', thread } : { state: 'empty' }
  } catch (error) {
    console.error('[studio] saved task read failed:', error)
    return { state: 'unavailable' }
  }
}
