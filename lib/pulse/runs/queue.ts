import 'server-only'
import { db } from '@/lib/db'
import { resolveCommercialEntitlement,type CommercialAccount } from '@/lib/tier'
import { runtimePlatformsFor } from '@/lib/pulse/platforms'
import { modelVariantsFor } from '@/lib/openrouter'
import { isoDate } from '@/lib/iso-date'
import type { PulseScope } from './schema'
export type DueRun=PulseScope & {id:string;scanWeek:string;allowedPlatforms:string[]}

/** Machine-only discovery; reachable from authenticated cron, never a session API. */
export async function readPulseTarget(clientId:string){
  const rows=await db()`select c.account_id,c.id as client_id,a.plan,a.status,a.stripe_subscription_id,a.trial_ends_at,a.override_plan,a.override_expires_at
    from clients c join accounts a on a.id=c.account_id where c.id=${clientId}::uuid and c.status='active'`
  const row=rows[0]
  return row?{accountId:String(row.account_id),clientId:String(row.client_id),allowedPlatforms:runtimePlatformsFor(resolveCommercialEntitlement(row as CommercialAccount).features.platform_access)}:null
}

/** Machine-only inventory, ordered by run id so broken clients cannot pin a page. */
export async function listPendingRunPage(after:string|null){
  const rows=await db()`select r.id,r.account_id,r.client_id,r.scan_week,a.plan,a.status,a.stripe_subscription_id,
      a.trial_ends_at,a.override_plan,a.override_expires_at
    from pulse_runs r join accounts a on a.id=r.account_id join clients c on c.id=r.client_id and c.account_id=r.account_id
    where (${after}::uuid is null or r.id>${after}::uuid) and exists(select 1 from pulse_run_items i where i.run_id=r.id
      and (i.status in ('queued','running','retry_wait','blocked')
        or (i.status='succeeded' and i.classification_status<>'classified'
          and (i.classification_attempt_count<3 or i.classification_lease_until is not null)))) order by r.id limit 50`
  return {runs:rows.map(row=>({id:String(row.id),accountId:String(row.account_id),clientId:String(row.client_id),scanWeek:isoDate(row.scan_week as string|Date,''),
    allowedPlatforms:runtimePlatformsFor(resolveCommercialEntitlement(row as CommercialAccount).features.platform_access)})),
    cursor:rows.length?String(rows.at(-1)!.id):null,exhausted:rows.length<50}
}

export async function unblockConfiguredItems(run:DueRun){
  if(!process.env.OPENROUTER_API_KEY)return
  const allowed=modelVariantsFor(run.allowedPlatforms).map(v=>v.model)
  if(!allowed.length)return
  await db()`update pulse_run_items i set status='queued',next_attempt_at=now(),updated_at=now()
    where i.account_id=${run.accountId} and i.client_id=${run.clientId}::uuid and i.run_id=${run.id}::uuid
      and i.status='blocked' and i.attempt_count<3 and i.model_id=any(${allowed}::text[])
      and exists(select 1 from pulse_item_attempts a where a.item_id=i.id and a.attempt_number=i.attempt_count
        and a.error_code in ('PROVIDER_NOT_CONFIGURED','PLAN_HAS_NO_PLATFORMS'))`
}

export async function hasDueItems(run:DueRun){
  const canClassify=!!process.env.OPENROUTER_API_KEY&&run.allowedPlatforms.length>0
  const [row]=await db()`select exists(select 1 from pulse_run_items where account_id=${run.accountId} and client_id=${run.clientId}::uuid
    and run_id=${run.id}::uuid and ((attempt_count<3 and ((status in ('queued','retry_wait') and next_attempt_at<=now())
      or (status='running' and lease_until<now()))) or (${canClassify} and status='succeeded' and classification_status<>'classified'
        and ((classification_attempt_count<3 and classification_next_at<=now()
        and classification_lease_until is null) or classification_lease_until<now())))) as due`
  return row?.due===true
}
