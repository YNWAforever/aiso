import { randomUUID } from 'node:crypto'
import { verifyReportRecoveryFixture } from './local-auth-safety.mjs'

export async function prepareReportRecoveryFixture(config, pool, email, scanFixture, record) {
  if (!['report-recovery', 'report-list', 'report-multi', 'report-conflict'].includes(config.scenario) || typeof email !== 'string'
    || !email.endsWith(`-${config.runId}@fixture-aiso.example`)) throw new Error('LOCAL_AUTH_REPORT_TARGET')
  const identities = await pool.query(`select u.id,p.account_id from neon_auth."user" u
    join public.profiles p on p.id=u.id where u.email=$1`, [email])
  if (identities.rowCount !== 1) throw new Error('LOCAL_AUTH_REAL_PROFILE_REQUIRED')
  const identity = identities.rows[0]
  const accountId = verifyReportRecoveryFixture(config, identity, email)
  const data = {
    mode: config.mode, scenario: config.scenario, userId: identity.id, accountId,
    clientId: randomUUID(), scanId: randomUUID(), foreignAccountId: randomUUID(), foreignClientId: randomUUID(),
    foreignScanId: randomUUID(), brandName: `SYNTHETIC report recovery ${email.split('-').slice(0, 2).join(' ')}`,
    providerCallsAllowed: false, monitoringEnabled: false, fixtureOnly: true,
  }
  const tx = await pool.connect()
  try {
    await tx.query('begin')
    const fresh = await tx.query(`update public.accounts a set plan='pro',trial_ends_at=now()+interval '1 day'
      where a.id=$1 and a.plan='basic' and a.status='active'
        and a.stripe_customer_id is null and a.stripe_subscription_id is null and a.override_plan is null
        and not exists(select 1 from public.clients c where c.account_id=a.id)
      returning a.id,a.plan,a.status,a.trial_ends_at`, [accountId])
    if (fresh.rowCount !== 1) throw new Error('LOCAL_AUTH_FRESH_REPORT_ACCOUNT_REQUIRED')
    await tx.query(`insert into public.clients(id,account_id,brand_name,domain,industry,region,status)
      values($1,$2,$3,'fixture-aiso.example','technology','HK','active')`, [data.clientId, accountId, data.brandName])
    await tx.query(`insert into public.account_report_branding(account_id,agency_name,primary_color,updated_by)
      values($1,'SYNTHETIC local report agency','#1D4ED8',$2)`, [accountId, identity.id])
    await tx.query(`insert into public.accounts(id,plan,status) values($1,'basic','active')`, [data.foreignAccountId])
    await tx.query(`insert into public.clients(id,account_id,brand_name,domain,industry,region,status)
      values($1,$2,'SYNTHETIC inaccessible foreign brand','fixture-aiso.example','technology','HK','active')`,
    [data.foreignClientId, data.foreignAccountId])
    for (const [scanId, owner, clientId] of [
      [data.scanId, accountId, data.clientId], [data.foreignScanId, data.foreignAccountId, data.foreignClientId],
    ]) await tx.query(`insert into public.scans(id,account_id,client_id,url,domain,score,grade,results,industry,region,created_at)
      values($1,$2,$3,'https://fixture-aiso.example/','fixture-aiso.example',$4,$5,$6::jsonb,'technology','HK',$7)`,
    [scanId, owner, clientId, scanFixture.score, scanFixture.grade, JSON.stringify(scanFixture.results), scanFixture.collectedAt])
    await tx.query('commit')
    record({ event: 'SYNTHETIC_REPORT_TRIAL_AND_SCAN_FIXTURE', ...data,
      entitlement: 'local-pro-trial', checkoutCalled: false, subscriptionConfigured: false })
    return data
  } catch (error) { await tx.query('rollback'); throw error }
  finally { tx.release() }
}
