import 'server-only'
import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'
import { isFeatureEnabled } from '@/lib/flags'
import { readLimitedJson } from '@/lib/approvals/request'
import { STUDIO_HOME_TEMPLATES, type StudioHomeTemplate } from './home'
import { STUDIO_PROMPT_LIMIT, type StudioLiveReply } from './live-types'
import type { StudioReply } from './types'
import type {
  StudioThreadCreateInput,
  StudioThreadRecord,
  StudioTurnCreateInput,
  StudioTurnLiveInput,
  StudioTurnRecord,
} from './threads-types'

export const STUDIO_THREAD_LIST_LIMIT = 50
export const STUDIO_THREAD_CAP = 200
export const STUDIO_TURN_CAP = 50
export const STUDIO_THREAD_BODY_LIMIT = 4 * 1024
export const STUDIO_TURN_BODY_LIMIT = 96 * 1024
const MAX_REPLY_BYTES = 65_536
const MAX_ATTACHED_BYTES = 4_096
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i

const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
const notFound = () => respond({ error: 'NOT_FOUND' }, 404)
const invalid = () => respond({ error: 'INVALID_STUDIO_THREAD' }, 400)
const unavailable = () => respond({ error: 'STUDIO_THREADS_UNAVAILABLE' }, 503)

type Authorized = {
  profileId: string
  accountId: string
  clientId: string
  /** Set for a staff principal (R3 A2b): the live 087 grant this request runs under. */
  staffGrantId: string | null
  sql: ReturnType<typeof db>
}

/**
 * The principal for every thread statement below is (account, brand, profile).
 * A member's is their own account. A platform admin opening ANOTHER account's
 * brand is a staff principal: the client's account, their own profile, and the
 * live grant that account gave them — re-checked on every request, so a revoke
 * or expiry takes effect on the next call. No grant reads exactly like a brand
 * that does not exist (404). Staff threads are written with their grant id, so
 * 088's composite FK binds each one to a grant naming this profile.
 */
async function authorize(clientId: string): Promise<Authorized | Response> {
  if (!isFeatureEnabled('conversation_studio')) return notFound()
  const profile = await getProfile()
  if (!profile) return respond({ error: 'UNAUTHENTICATED' }, 401)
  if (!UUID.test(clientId)) return notFound()
  const sql = db()
  const brands = await sql`select id from clients where id = ${clientId}::uuid and account_id = ${profile.account_id} and status = 'active'`
  if (brands[0]) return { profileId: profile.id, accountId: profile.account_id, clientId, staffGrantId: null, sql }
  if (profile.is_admin !== true) return notFound()
  const granted = await sql`
    select c.account_id, g.id as grant_id
    from clients c
    join studio_staff_grants g on g.account_id = c.account_id
    where c.id = ${clientId}::uuid and c.status = 'active'
      and g.grantee_profile_id = ${profile.id}::uuid
      and g.revoked_at is null and g.expires_at > now()
    limit 1`
  if (!granted[0]) return notFound()
  return { profileId: profile.id, accountId: String(granted[0].account_id), clientId, staffGrantId: String(granted[0].grant_id), sql }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value : null
}

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null
  return typeof value === 'string' && value.length <= max ? value : undefined
}

function isTask(value: unknown): value is StudioHomeTemplate {
  return typeof value === 'string' && (STUDIO_HOME_TEMPLATES as readonly string[]).includes(value)
}

function isReply(value: unknown): value is StudioReply {
  if (!isObject(value)) return false
  if (value.status !== 'evidenced' && value.status !== 'insufficient') return false
  if (value.template !== null && typeof value.template !== 'string') return false
  if (!Array.isArray(value.observations) || !Array.isArray(value.researchSteps)) return false
  if (value.scan !== null && !isObject(value.scan)) return false
  if (!isObject(value.coverage)) return false
  return Buffer.byteLength(JSON.stringify(value)) <= MAX_REPLY_BYTES
}

function isAttached(value: unknown): value is { label: string; versionNumber: number } {
  return isObject(value)
    && Object.keys(value).length === 2
    && typeof value.label === 'string' && value.label.length > 0 && value.label.length <= 200
    && Number.isSafeInteger(value.versionNumber) && (value.versionNumber as number) >= 0
    && Buffer.byteLength(JSON.stringify(value)) <= MAX_ATTACHED_BYTES
}

function readLive(value: unknown): StudioTurnLiveInput | null {
  if (!isObject(value) || 'pending' in value) return null
  const keys = Object.keys(value)
  if (keys.length !== 1) return null
  if (keys[0] === 'error') return typeof value.error === 'string' && value.error.length <= 120 ? { error: value.error } : null
  if (keys[0] === 'reply') {
    if (!isObject(value.reply) || !Array.isArray(value.reply.answers) || !isObject(value.reply.quota)) return null
    if (Buffer.byteLength(JSON.stringify(value)) > MAX_REPLY_BYTES) return null
    return { reply: value.reply as unknown as StudioLiveReply }
  }
  return null
}

function parseCreateThread(raw: unknown): StudioThreadCreateInput | null {
  if (!isObject(raw)) return null
  const allowed = ['kind', 'title', 'goal', 'week', 'sourceTitle']
  if (Object.keys(raw).some(key => !allowed.includes(key))) return null
  const kind = raw.kind === 'research' || raw.kind === 'brief' ? raw.kind : null
  const title = text(raw.title, 200)
  const goal = text(raw.goal, STUDIO_PROMPT_LIMIT)
  const week = optionalText(raw.week, 40)
  const sourceTitle = optionalText(raw.sourceTitle, 200)
  if (!kind || !title || !goal || week === undefined || sourceTitle === undefined) return null
  return { kind, title, goal, week, sourceTitle }
}

function parseCreateTurn(raw: unknown): StudioTurnCreateInput | null {
  if (!isObject(raw)) return null
  const allowed = ['prompt', 'task', 'reply', 'attached']
  if (Object.keys(raw).some(key => !allowed.includes(key))) return null
  const prompt = text(raw.prompt, STUDIO_PROMPT_LIMIT)
  const task = raw.task === null || raw.task === undefined ? null : isTask(raw.task) ? raw.task : undefined
  if (!prompt || task === undefined || !isReply(raw.reply)) return null
  if (raw.attached !== undefined && raw.attached !== null && !isAttached(raw.attached)) return null
  return { prompt, task, reply: raw.reply, attached: (raw.attached ?? null) as StudioTurnCreateInput['attached'] }
}

function parseFinalizeLive(raw: unknown): { position: number; live: StudioTurnLiveInput } | null {
  if (!isObject(raw)) return null
  if (Object.keys(raw).some(key => !['position', 'live'].includes(key))) return null
  const position = raw.position
  if (!Number.isSafeInteger(position) || (position as number) < 0) return null
  const live = readLive(raw.live)
  return live ? { position: position as number, live } : null
}

function threadRecord(row: Record<string, unknown>): StudioThreadRecord {
  return {
    id: String(row.id),
    title: String(row.title),
    goal: String(row.goal),
    week: row.week === null || row.week === undefined ? null : String(row.week),
    kind: row.kind === 'brief' ? 'brief' : 'research',
    sourceTitle: row.source_title === null || row.source_title === undefined ? null : String(row.source_title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    turnCount: Number(row.turn_count ?? 0),
    skill: (STUDIO_HOME_TEMPLATES as readonly unknown[]).includes(row.first_task) ? row.first_task as StudioHomeTemplate : null,
  }
}

function turnRecord(row: Record<string, unknown>): StudioTurnRecord {
  return {
    id: String(row.id),
    position: Number(row.position),
    prompt: String(row.prompt),
    task: isTask(row.task) ? row.task : null,
    reply: row.reply as StudioReply,
    attached: (row.attached ?? null) as StudioTurnRecord['attached'],
    live: (row.live ?? null) as StudioTurnRecord['live'],
    createdAt: String(row.created_at),
  }
}

export async function listStudioThreads(_request: Request, clientId: string): Promise<Response> {
  try {
    const access = await authorize(clientId)
    if (access instanceof Response) return access
    const rows = await access.sql`
      select t.id, t.title, t.goal, t.week, t.kind, t.source_title, t.created_at, t.updated_at,
        (select count(*)::int from studio_thread_turns u
          where u.thread_id = t.id and u.account_id = t.account_id
            and u.client_id = t.client_id and u.profile_id = t.profile_id) as turn_count,
        (select f.task from studio_thread_turns f
          where f.thread_id = t.id and f.account_id = t.account_id
            and f.client_id = t.client_id and f.profile_id = t.profile_id
          order by f.position limit 1) as first_task
      from studio_threads t
      where t.account_id = ${access.accountId}::uuid
        and t.client_id = ${access.clientId}::uuid
        and t.profile_id = ${access.profileId}::uuid
      order by t.updated_at desc, t.id desc
      limit ${STUDIO_THREAD_LIST_LIMIT + 1}
    `
    const truncated = rows.length > STUDIO_THREAD_LIST_LIMIT
    return respond({ threads: rows.slice(0, STUDIO_THREAD_LIST_LIMIT).map(row => threadRecord(row as Record<string, unknown>)), truncated })
  } catch (error) {
    console.error('[studio] list threads failed:', error)
    return unavailable()
  }
}

export async function createStudioThread(request: Request, clientId: string): Promise<Response> {
  try {
    const access = await authorize(clientId)
    if (access instanceof Response) return access
    let raw: unknown
    try { raw = await readLimitedJson(request, STUDIO_THREAD_BODY_LIMIT) } catch { return invalid() }
    const input = parseCreateThread(raw)
    if (!input) return invalid()
    // One statement: the thread, and for a staff principal its 'thread' audit
    // row in the client account (087), so a staff save is never unrecorded.
    const rows = await access.sql`
      with inserted as (
        insert into studio_threads (account_id, client_id, profile_id, staff_grant_id, kind, title, goal, week, source_title)
        select ${access.accountId}::uuid, ${access.clientId}::uuid, ${access.profileId}::uuid, ${access.staffGrantId}::uuid,
          ${input.kind}, ${input.title}, ${input.goal}, ${input.week}, ${input.sourceTitle ?? null}
        where (select count(*) from studio_threads
          where account_id = ${access.accountId}::uuid
            and client_id = ${access.clientId}::uuid
            and profile_id = ${access.profileId}::uuid) < ${STUDIO_THREAD_CAP}
        returning id, title, goal, week, kind, source_title, created_at, updated_at, 0 as turn_count, null as first_task
      ), audited as (
        insert into studio_staff_audit (account_id, client_id, actor_profile_id, action)
        select ${access.accountId}::uuid, ${access.clientId}::uuid, ${access.profileId}::uuid, 'thread'
        from inserted where ${access.staffGrantId}::uuid is not null
        returning id
      )
      select inserted.* from inserted
    `
    if (!rows[0]) return respond({ error: 'STUDIO_THREAD_FULL' }, 409)
    return respond({ thread: threadRecord(rows[0] as Record<string, unknown>) }, 201)
  } catch (error) {
    console.error('[studio] create thread failed:', error)
    return unavailable()
  }
}

export async function getStudioThread(_request: Request, clientId: string, threadId: string): Promise<Response> {
  try {
    const access = await authorize(clientId)
    if (access instanceof Response) return access
    if (!isUuid(threadId)) return notFound()
    const rows = await access.sql`
      select t.id, t.title, t.goal, t.week, t.kind, t.source_title, t.created_at, t.updated_at,
        (select count(*)::int from studio_thread_turns u
          where u.thread_id = t.id and u.account_id = t.account_id
            and u.client_id = t.client_id and u.profile_id = t.profile_id) as turn_count,
        (select f.task from studio_thread_turns f
          where f.thread_id = t.id and f.account_id = t.account_id
            and f.client_id = t.client_id and f.profile_id = t.profile_id
          order by f.position limit 1) as first_task
      from studio_threads t
      where t.id = ${threadId}::uuid
        and t.account_id = ${access.accountId}::uuid
        and t.client_id = ${access.clientId}::uuid
        and t.profile_id = ${access.profileId}::uuid
      limit 1
    `
    if (!rows[0]) return notFound()
    const turns = await access.sql`
      select id, position, prompt, task, reply, attached, live, created_at
      from studio_thread_turns
      where thread_id = ${threadId}::uuid
        and account_id = ${access.accountId}::uuid
        and client_id = ${access.clientId}::uuid
        and profile_id = ${access.profileId}::uuid
      order by position asc
      limit ${STUDIO_TURN_CAP}
    `
    return respond({
      thread: threadRecord(rows[0] as Record<string, unknown>),
      turns: turns.map(row => turnRecord(row as Record<string, unknown>)),
    })
  } catch (error) {
    console.error('[studio] read thread failed:', error)
    return unavailable()
  }
}

export async function appendStudioTurn(request: Request, clientId: string, threadId: string): Promise<Response> {
  try {
    const access = await authorize(clientId)
    if (access instanceof Response) return access
    if (!isUuid(threadId)) return notFound()
    let raw: unknown
    try { raw = await readLimitedJson(request, STUDIO_TURN_BODY_LIMIT) } catch { return invalid() }
    const input = parseCreateTurn(raw)
    if (!input) return invalid()
    // A staff view cannot attach a source (that reads the viewer's own account).
    if (access.staffGrantId && input.attached) return invalid()
    const owned = await access.sql`
      select id from studio_threads
      where id = ${threadId}::uuid
        and account_id = ${access.accountId}::uuid
        and client_id = ${access.clientId}::uuid
        and profile_id = ${access.profileId}::uuid
      limit 1
    `
    if (!owned[0]) return notFound()
    const rows = await access.sql`
      with touched as (
        update studio_threads set updated_at = clock_timestamp()
        where id = ${threadId}::uuid
          and account_id = ${access.accountId}::uuid
          and client_id = ${access.clientId}::uuid
          and profile_id = ${access.profileId}::uuid
        returning id
      ), next as (
        select coalesce(max(position) + 1, 0) as position, count(*)::int as count
        from studio_thread_turns
        where thread_id = ${threadId}::uuid
          and account_id = ${access.accountId}::uuid
          and client_id = ${access.clientId}::uuid
          and profile_id = ${access.profileId}::uuid
      ), inserted as (
        insert into studio_thread_turns (thread_id, account_id, client_id, profile_id, position, prompt, task, reply, attached)
        select touched.id, ${access.accountId}::uuid, ${access.clientId}::uuid, ${access.profileId}::uuid,
          next.position, ${input.prompt}, ${input.task}, ${JSON.stringify(input.reply)}::jsonb, ${input.attached ? JSON.stringify(input.attached) : null}::jsonb
        from touched, next
        where next.count < ${STUDIO_TURN_CAP}
        returning id, position, prompt, task, reply, attached, live, created_at
      )
      select * from inserted
    `
    if (!rows[0]) return respond({ error: 'STUDIO_THREAD_FULL' }, 409)
    return respond({ turn: turnRecord(rows[0] as Record<string, unknown>) }, 201)
  } catch (error) {
    console.error('[studio] append turn failed:', error)
    return unavailable()
  }
}

export async function finalizeStudioTurn(request: Request, clientId: string, threadId: string): Promise<Response> {
  try {
    const access = await authorize(clientId)
    if (access instanceof Response) return access
    if (!isUuid(threadId)) return notFound()
    let raw: unknown
    try { raw = await readLimitedJson(request, STUDIO_TURN_BODY_LIMIT) } catch { return invalid() }
    const input = parseFinalizeLive(raw)
    if (!input) return invalid()
    // A staff view never runs a LIVE answer, so it has none to record.
    if (access.staffGrantId) return invalid()
    const rows = await access.sql`
      update studio_thread_turns set live = ${JSON.stringify(input.live)}::jsonb
      where thread_id = ${threadId}::uuid
        and position = ${input.position}
        and account_id = ${access.accountId}::uuid
        and client_id = ${access.clientId}::uuid
        and profile_id = ${access.profileId}::uuid
      returning id, position, prompt, task, reply, attached, live, created_at
    `
    if (!rows[0]) return notFound()
    await access.sql`
      update studio_threads set updated_at = clock_timestamp()
      where id = ${threadId}::uuid
        and account_id = ${access.accountId}::uuid
        and client_id = ${access.clientId}::uuid
        and profile_id = ${access.profileId}::uuid
    `
    return respond({ turn: turnRecord(rows[0] as Record<string, unknown>) })
  } catch (error) {
    console.error('[studio] finalize turn failed:', error)
    return unavailable()
  }
}
