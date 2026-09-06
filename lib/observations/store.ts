import 'server-only'
import { db } from '@/lib/db'
import { isoDate } from '@/lib/iso-date'
import { MAX_PROMPTS } from '@/lib/pulse/limits'
import { encodeObservationCursor, type ObservationQuery } from '@/lib/observations/query'
import { projectObservation } from '@/lib/observations/schema'
import type { ObservationResponse, PulseSourceRow, Question } from '@/lib/observations/types'

type ItemRow = Omit<PulseSourceRow, 'raw_answer' | 'scan_week'> & {
  scan_week: string | Date
  has_answer: boolean
  current_prompt: Question | null
}
interface SnapshotRow {
  owned: boolean
  selected_week: string | Date | null
  weeks: (string | Date)[]
  questions: Question[]
  items: ItemRow[]
  recorded_rows: number | string
  successful_rows: number | string
}

function projectQuestion(row: Question): Question {
  return { id: row.id.toLowerCase(), question: row.question, category: row.category, language: row.language, isActive: row.isActive }
}

/** All evidence and denominators come from the same PostgreSQL statement snapshot. */
export async function loadObservationSnapshot(accountId: string, clientId: string, query: ObservationQuery): Promise<ObservationResponse | null> {
  const sql = db()
  const cursor = query.cursor
  const rows = await sql`
    with owned as (
      select id, account_id from clients where id = ${clientId} and account_id = ${accountId}
    ), retained_weeks as (
      select distinct m.scan_week from pulse_metrics m join owned c on c.id = m.client_id
      order by m.scan_week desc limit 40
    ), selected_week as (
      select coalesce(${query.week}::date, max(scan_week)) as week from retained_weeks
    ), filtered as (
      select m.id, m.prompt_id, m.question, m.platform, m.scan_week, m.created_at, m.brand_mentioned,
        coalesce(m.raw_answer ~ '[^[:space:]]', false) as has_answer,
        m.brand_mentioned is not null as classified,
        case when p.id is null then null else jsonb_build_object(
          'id', p.id, 'question', p.question, 'category', p.category,
          'language', p.language, 'isActive', p.is_active
        ) end as current_prompt
      from pulse_metrics m join owned c on c.id = m.client_id
      cross join selected_week w
      left join prompt_bank p on p.id = m.prompt_id and p.client_id = m.client_id and p.client_id = c.id
      where m.scan_week = w.week
        and (${query.promptId}::uuid is null or m.prompt_id = ${query.promptId})
        and (${query.platform}::text is null or m.platform = ${query.platform})
    ), counts as (
      select count(*) as recorded_rows,
        count(*) filter (where has_answer and classified) as successful_rows from filtered
    ), page_rows as (
      select * from filtered
      where (${query.result}::text is null
        or (${query.result} = 'success' and has_answer and classified)
        or (${query.result} = 'incomplete' and not (has_answer and classified)))
        and (${cursor === null}::boolean
          or (${cursor?.recordedAt ?? null}::timestamptz is not null and (
            created_at < ${cursor?.recordedAt ?? null}::timestamptz
            or (created_at = ${cursor?.recordedAt ?? null}::timestamptz and id < ${cursor?.id ?? null}::uuid)
            or created_at is null))
          or (${cursor?.recordedAt ?? null}::timestamptz is null and created_at is null and id < ${cursor?.id ?? null}::uuid))
      order by created_at desc nulls last, id desc limit ${query.limit + 1}
    ), current_questions as (
      select p.id, p.question, p.category, p.language, p.is_active
      from prompt_bank p join owned c on c.id = p.client_id
      order by p.id limit ${MAX_PROMPTS + 1}
    )
    select exists(select 1 from owned) as owned,
      (select week from selected_week) as selected_week,
      coalesce((select jsonb_agg(scan_week order by scan_week desc) from retained_weeks), '[]'::jsonb) as weeks,
      coalesce((select jsonb_agg(jsonb_build_object(
        'id', q.id, 'question', q.question, 'category', q.category,
        'language', q.language, 'isActive', q.is_active
      ) order by q.id) from current_questions q), '[]'::jsonb) as questions,
      coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'prompt_id', r.prompt_id, 'question', r.question, 'platform', r.platform,
        'scan_week', r.scan_week,
        'created_at', to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'brand_mentioned', r.brand_mentioned, 'has_answer', r.has_answer, 'current_prompt', r.current_prompt
      ) order by r.created_at desc nulls last, r.id desc) from page_rows r), '[]'::jsonb) as items,
      counts.recorded_rows, counts.successful_rows from counts
  ` as SnapshotRow[]
  const row = rows[0]
  if (!row?.owned) return null

  // Keep the database text timestamp intact: Date would discard microseconds and skip rows.
  const page = row.items.slice(0, query.limit)
  const last = page.at(-1)
  const recordedRows = Number(row.recorded_rows)
  const successfulRows = Number(row.successful_rows)
  return {
    schemaVersion: 1,
    clientId,
    selectedWeek: row.selected_week === null ? null : isoDate(row.selected_week, ''),
    weeks: row.weeks.map(week => isoDate(week, '')),
    questionsTruncated: row.questions.length > MAX_PROMPTS,
    questions: row.questions.slice(0, MAX_PROMPTS).map(projectQuestion),
    items: page.map(item => projectObservation({ ...item, scan_week: isoDate(item.scan_week, ''), raw_answer: null }, item.current_prompt)),
    counts: { recordedRows, successfulRows, incompleteRows: recordedRows - successfulRows },
    nextCursor: row.items.length > query.limit && last
      ? encodeObservationCursor({ recordedAt: last.created_at, id: last.id })
      : null,
  }
}
