import 'server-only'
import { db } from '@/lib/db'
import type { CandidateCursor } from '@/lib/pulse/schedule'
export type WeeklyEnqueue={scanWeek:string;after:CandidateCursor|null;failedClientIds:string[];complete:boolean}
/** Recover the persisted weekly intent, including an interrupted initial request. */
export async function readWeeklyEnqueue(){
  const [row]=await db()`with latest as (
    select distinct on (detail->'enqueue'->>'scanWeek') id,detail,started_at from cron_runs
    where route='/api/cron/pulse' and detail->>'mode'='weekly' and detail ? 'enqueue'
    order by detail->'enqueue'->>'scanWeek',started_at desc,id desc
  ) select id,detail->'enqueue' as enqueue from latest where detail->'enqueue'->>'complete'='false'
    order by detail->'enqueue'->>'scanWeek' limit 1`
  const state=row?.enqueue as WeeklyEnqueue|undefined
  return state && !state.complete?{id:String(row.id),state}:null
}
/** Compare-and-set protects a later checkpoint from an old dispatch finishing late. */
export async function saveWeeklyEnqueue(id:string,previous:WeeklyEnqueue,next:WeeklyEnqueue){
  await db()`update cron_runs set detail=jsonb_set(detail,'{enqueue}',${JSON.stringify(next)}::jsonb)
    where id=${id}::uuid and route='/api/cron/pulse' and detail->'enqueue'=${JSON.stringify(previous)}::jsonb`
}
export async function readRepairCursor(){
  const [row]=await db()`select detail->>'nextRunCursor' as cursor from cron_runs
    where route='/api/cron/pulse' and detail->>'mode'='repair' and finished_at is not null order by started_at desc,id desc limit 1`
  return typeof row?.cursor==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(row.cursor)?row.cursor:null
}
