import pg from 'pg'
import { expect } from '@playwright/test'
import { config } from './support.mjs'
import { allowLocalUrl, runSpec, verifyDatabase } from '../../scripts/ci/local-auth-safety.mjs'

export async function reportDatabase(role = 'local_owner') {
  const spec = runSpec(config.runId, config.imageId)
  if (!['report-recovery', 'report-list', 'report-multi'].includes(config.scenario) || !config.containerVerified ||
    config.database !== spec.database || config.dbHost !== '127.0.0.1') throw new Error('LOCAL_AUTH_REPORT_TARGET')
  const pool = new pg.Pool({
    host: config.dbHost, port: config.dbPort, database: config.database, user: role,
    ['pass' + 'word']: role === 'local_owner' ? config.ownerPassword : config.appPassword,
    max: 3,
  })
  try {
    const proof = (await pool.query(`select current_setting('neon.project_id',true) project_id,
      current_setting('neon.branch_id',true) branch_id,current_database() as database,current_user as role`)).rows[0]
    verifyDatabase(proof, spec, role)
    return pool
  } catch (error) { await pool.end(); throw error }
}

// Forward exactly once to the actual App API, then withhold or drop only its
// response. No response data or authentication is fabricated.
export async function interruptCommittedSave(page, path, mode, audit) {
  allowLocalUrl(new URL(path, config.appOrigin).href, config.allowedOrigins)
  let release, resolveCaptured, rejectCaptured
  const gate = new Promise(done => { release = done })
  const captured = new Promise((done, fail) => { resolveCaptured = done; rejectCaptured = fail })
  const pattern = `${config.appOrigin}${path}`
  const handler = async route => {
    const request = route.request()
    if (request.method() !== 'POST') return route.continue()
    try {
      const headers = request.headers(), body = request.postDataJSON()
      const response = await route.fetch({ timeout: 30000 })
      const data = await response.json()
      const entry = { path, method: 'POST', requestId: headers['x-report-request-id'],
        scanId: headers['x-report-scan-id'], body, status: response.status(), result: data }
      audit.disruptions.push(entry)
      resolveCaptured(entry)
      if (mode === 'timeout') await gate
      try { await route.abort('failed') } catch { /* The actual client deadline can already have cancelled it. */ }
    } catch (error) { rejectCaptured(error); try { await route.abort() } catch {} }
  }
  await page.route(pattern, handler)
  return {
    captured: () => captured,
    async close() { release(); await page.unroute(pattern, handler) },
  }
}

export async function reportRows(pool, fixture) {
  const reports = (await pool.query(`select id,status,latest_version_id,published_version_id
    from public.client_reports where account_id=$1 and client_id=$2 order by created_at,id`,
  [fixture.accountId, fixture.clientId])).rows
  const versions = (await pool.query(`select id,report_id,version_number,source_scan_id,locale,executive_summary,snapshot
    from public.client_report_versions where account_id=$1 and client_id=$2 order by report_id,version_number`,
  [fixture.accountId, fixture.clientId])).rows
  const receipts = (await pool.query(`select request_id,report_id,version_id,request_payload,
    result->'version'->>'id' as acknowledged_version_id
    from public.report_save_receipts where account_id=$1 and client_id=$2 and actor_id=$3 order by created_at,request_id`,
  [fixture.accountId, fixture.clientId, fixture.userId])).rows
  return { reports, versions, receipts }
}

export async function concurrentReportRetry(page, owner, fixture, saved, lang) {
  const app = await reportDatabase(config.appRole)
  const writer = await app.connect()
  const requestId = crypto.randomUUID(), text = lang === 'en'
    ? 'SYNTHETIC concurrency receipt: review only this saved scan evidence before making any website changes.'
    : '合成多連線測試摘要：只核對本次已儲存掃描的來源證據，並在任何網站修改前由人手確認相關內容。'
  let pending = [], open = false
  try {
    await writer.query('begin')
    open = true
    const pid = (await writer.query('select pg_backend_pid() pid')).rows[0].pid
    const raw = (await writer.query(`select public.save_client_report_draft_request(
      p_request_id=>$1::uuid,p_report_id=>$2::uuid,p_account_id=>$3::uuid,p_client_id=>$4::uuid,
      p_source_scan_id=>$5::uuid,p_previous_scan_id=>null::uuid,p_locale=>$6,
      p_executive_summary=>$7,p_snapshot_schema_version=>1,p_snapshot=>$8::jsonb,p_created_by=>$9::uuid) result`,
    [requestId, saved.reportId, fixture.accountId, fixture.clientId, fixture.scanId, lang, text,
      JSON.stringify({ ...saved.snapshot, executiveSummary: text }), fixture.userId])).rows[0].result
    const path = `/api/client-reports/${saved.reportId}/versions`
    const request = () => page.context().request.post(new URL(path, config.appOrigin).href, {
      headers: { 'X-Report-Request-Id': requestId, 'X-Report-Scan-Id': fixture.scanId },
      data: { locale: lang, executiveSummary: text }, timeout: 45000,
    }).then(async response => ({ status: response.status(), body: await response.json() }))
    pending = [request(), request()]
    let waiters = []
    await expect.poll(async () => {
      waiters = (await owner.query(`select pid,wait_event_type,pg_blocking_pids(pid) blockers
        from pg_stat_activity where datname=$1 and usename=$2 and wait_event_type='Lock'
        and position($3 in query)>0`, [config.database, config.appRole, 'save_client_report_draft_request'])).rows
      return waiters.length >= 2 && waiters.some(row => row.blockers.includes(pid))
    }, { timeout: 10000, intervals: [100, 250, 500] }).toBe(true)
    expect(new Set(waiters.map(row => row.pid)).size).toBeGreaterThanOrEqual(2)
    const before = await reportRows(owner, fixture)
    expect(before.versions).toHaveLength(saved.versionNumber)
    expect(before.receipts.some(row => row.request_id === requestId)).toBe(false)
    await writer.query('commit')
    open = false
    const responses = await Promise.all(pending)
    for (const response of responses) {
      expect(response.status).toBe(201)
      expect(response.body.reviewArtifact.versionId).toBe(raw.version.id)
      expect(response.body.reviewArtifact.snapshot.executiveSummary).toBe(text)
    }
    expect(responses[1]).toEqual(responses[0])
    const after = await reportRows(owner, fixture)
    expect(after.reports).toHaveLength(1)
    expect(after.versions).toHaveLength(saved.versionNumber + 1)
    expect(after.receipts.filter(row => row.request_id === requestId)).toHaveLength(1)
    expect(after.reports[0].latest_version_id).toBe(raw.version.id)
    expect(after.reports[0].published_version_id).toBeNull()
    return { requestId, writerPid: pid, waiters, responses,
      reportId: raw.report.id, versionId: raw.version.id, versionNumber: raw.version.version_number,
      summary: text, snapshot: responses[0].body.reviewArtifact.snapshot,
      after: { reportCount: after.reports.length, versionCount: after.versions.length, receiptCount: after.receipts.length } }
  } finally {
    if (open) await writer.query('rollback')
    await Promise.allSettled(pending)
    writer.release()
    await app.end()
  }
}
