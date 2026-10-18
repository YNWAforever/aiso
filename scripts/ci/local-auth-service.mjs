import { createServer } from 'node:https'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { magicLink } from 'better-auth/plugins'
import { toNodeHandler } from 'better-auth/node'
import { verifyOwnedFixtureBrand, verifyMultiBrandFixture } from './local-auth-safety.mjs'
import { prepareReportRecoveryFixture } from './local-report-fixture.mjs'

export function engineOptions(config, database, mailbox, onUser) {
  return {
    baseURL: config.authOrigin, basePath: '/api/auth', database,
    secret: config.engineSecret, trustedOrigins: [config.appOrigin, config.authOrigin],
    rateLimit: { enabled: true },
    advanced: { cookiePrefix: 'neon-auth', useSecureCookies: true, database: { generateId: 'uuid' } },
    session: { cookieCache: { enabled: false } },
    databaseHooks: { user: { create: { after: onUser } } },
    plugins: [magicLink({
      storeToken: 'hashed', expiresIn: 300,
      sendMagicLink: async ({ email, url }) => {
        // The pinned bare Better Auth 1.6.23 verification endpoint decodes
        // callbackURL once after query parsing. Preserve nested query escapes
        // in this local mail adapter; the real engine still consumes its token,
        // checks the redirect origin and creates/revokes the signed session.
        // This is a local interoperability adapter, not hosted Neon evidence.
        const delivered = new URL(url)
        for (const key of ['callbackURL', 'newUserCallbackURL', 'errorCallbackURL']) {
          const callback = delivered.searchParams.get(key)
          if (callback) delivered.searchParams.set(key, encodeURIComponent(callback))
        }
        mailbox.set(email, delivered.href)
      },
    })],
  }
}

export async function startAuthService(config, authPool, ownerPool, fixture, record) {
  const mailbox = new Map(), fixtureByEmail = new Map(), multiBrandPlans = new Map()
  const reportFixtures = new Map()
  let nextLoginAt = 0, loginSlots = 0, lastMagicRequestAt = 0
  const options = engineOptions(config, authPool, mailbox, async user => {
    const response = await fetch(`${config.appOrigin}/api/webhooks/neon`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: 'user.created', user: { id: user.id, email: user.email, name: user.name } }),
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(`LOCAL_AUTH_PROVISIONING_${response.status}`)
    record({ event: 'application-user-created-webhook', userId: user.id, status: response.status })
  })
  const engine = betterAuth(options)
  const handler = toNodeHandler(engine)
  const server = createServer({ key: readFileSync(config.keyPath), cert: readFileSync(config.certPath) })
  server.on('request', async (request, response) => {
    try {
      const url = new URL(request.url, config.authOrigin)
      if (url.pathname.startsWith('/__local/')) {
        if (request.headers.authorization !== `Bearer ${config.controlSecret}`) {
          response.writeHead(403); response.end(); return
        }
        const email = url.searchParams.get('email')
        if (url.pathname === '/__local/report-fixture') {
          if (!['report-recovery', 'report-list', 'report-multi'].includes(config.scenario)) throw new Error('LOCAL_AUTH_REPORT_TARGET')
          if (!reportFixtures.has(email)) reportFixtures.set(email,
            prepareReportRecoveryFixture(config, ownerPool, email, fixture.selected, record))
          const data = await reportFixtures.get(email)
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify(data)); return
        }
        if (url.pathname === '/__local/login-slot') {
          // Better Auth's pinned memory limiter resets after a quiet window,
          // rather than subtracting old requests continuously. Four sessions
          // then an actual 61s quiet period stays below its unchanged 5 limit.
          if (loginSlots > 0 && loginSlots % 4 === 0) {
            nextLoginAt = Math.max(nextLoginAt, lastMagicRequestAt + 61000)
          }
          const now = Date.now(), delayMs = Math.max(0, nextLoginAt - now)
          nextLoginAt = now + delayMs + 31000
          loginSlots++
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify({ delayMs }))
          return
        }
        if (url.pathname === '/__local/mailbox') {
          const link = mailbox.get(email)
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify(link ? { link } : { pending: true }))
          return
        }
        if (url.pathname === '/__local/multi-brand-account') {
          if (config.scenario !== 'brand-isolation') throw new Error('LOCAL_AUTH_MULTI_BRAND_TARGET')
          const identity = await ownerPool.query(`select u.id,p.account_id from neon_auth."user" u
            join public.profiles p on p.id=u.id where u.email=$1`, [email])
          if (identity.rowCount !== 1) throw new Error('LOCAL_AUTH_REAL_PROFILE_REQUIRED')
          const accountId = verifyMultiBrandFixture(config, identity.rows[0], email)
          let data = multiBrandPlans.get(accountId)
          if (!data) {
            // Only a new, run-owned synthetic account, before any brand exists.
            // Keep real entitlement rules and triggers active. No checkout,
            // subscription identity, role grant or production setting is used.
            const result = await ownerPool.query(`update public.accounts a set plan='pro'
              where a.id=$1 and a.plan='basic' and a.status='active'
                and a.stripe_customer_id is null and a.stripe_subscription_id is null
                and a.override_plan is null
                and not exists(select 1 from public.clients c where c.account_id=a.id)
              returning a.id,a.plan,a.status`, [accountId])
            if (result.rowCount !== 1) throw new Error('LOCAL_AUTH_FRESH_ACCOUNT_REQUIRED')
            data = { accountId, plan: result.rows[0].plan, status: result.rows[0].status,
              fixtureOnly: true, checkoutCalled: false, subscriptionConfigured: false }
            multiBrandPlans.set(accountId, data)
            record({ event: 'LOCAL_SYNTHETIC_PRO_PLAN_FIXTURE', ...data })
          }
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify(data)); return
        }
        if (url.pathname === '/__local/fixture') {
          if (!email || !email.endsWith('@fixture-aiso.example')) throw new Error('LOCAL_AUTH_FIXTURE_EMAIL')
          const fixtureKey = config.scenario === 'brand-isolation' ? `${email}:${url.searchParams.get('clientId')}` : email
          let data = fixtureByEmail.get(fixtureKey)
          if (!data) {
            const identity = await ownerPool.query(
              `select u.id, p.account_id from neon_auth."user" u join public.profiles p on p.id=u.id where u.email=$1`,
              [email],
            )
            if (identity.rowCount !== 1) throw new Error('LOCAL_AUTH_REAL_PROFILE_REQUIRED')
            const user = identity.rows[0]
            const clientId = url.searchParams.get('clientId')
            const brand = await ownerPool.query(`select id,account_id,brand_name,domain,industry,region,description,competitors
              from public.clients where id=$1 and account_id=$2`, [clientId, user.account_id])
            verifyOwnedFixtureBrand(brand.rows[0], user, clientId)
            data = { userId: user.id, accountId: user.account_id, clientId,
              scanId: randomUUID(), decoyScanId: randomUUID(),
              foreignAccountId: randomUUID(), foreignClientId: randomUUID(), foreignScanId: randomUUID(),
              originalBrand: brand.rows[0], mode: config.mode }
            const connection = await ownerPool.connect()
            try {
              await connection.query('begin')
              await connection.query(`insert into public.accounts(id,plan,status) values($1,'basic','active')`, [data.foreignAccountId])
              await connection.query(`insert into public.clients(id,account_id,brand_name,domain,industry,region,status)
                  values($1,$2,$3,'fixture-aiso.example','technology','HK','active')`,
                [data.foreignClientId, data.foreignAccountId, 'SYNTHETIC local Foreign'])
              for (const [id, accountId, clientId, value, at] of [
                [data.scanId, data.accountId, data.clientId, fixture.selected, fixture.selected.collectedAt],
                [data.decoyScanId, data.accountId, data.clientId, fixture.decoy, '2026-10-17T00:01:00.000Z'],
                [data.foreignScanId, data.foreignAccountId, data.foreignClientId, fixture.selected, fixture.selected.collectedAt],
              ]) {
                await connection.query(`insert into public.scans(id,account_id,client_id,url,domain,score,grade,results,industry,region,created_at)
                  values($1,$2,$3,'https://fixture-aiso.example/','fixture-aiso.example',$4,$5,$6::jsonb,'technology','HK',$7)`,
                [id, accountId, clientId, value.score, value.grade, JSON.stringify(value.results), at])
              }
              await connection.query('commit')
            } catch (error) { await connection.query('rollback'); throw error }
            finally { connection.release() }
            fixtureByEmail.set(fixtureKey, data)
            record({ event: 'SYNTHETIC-scan-fixture-created-for-existing-brand', ...data })
          }
          if (data.clientId !== url.searchParams.get('clientId')) throw new Error('LOCAL_AUTH_FIXTURE_REBIND_DENIED')
          response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(data)); return
        }
        if (url.pathname === '/__local/brand') {
          const identity = await ownerPool.query(`select u.id,p.account_id from neon_auth."user" u
            join public.profiles p on p.id=u.id where u.email=$1`, [email])
          if (identity.rowCount !== 1) throw new Error('LOCAL_AUTH_REAL_PROFILE_REQUIRED')
          const clientId = url.searchParams.get('clientId'), user = identity.rows[0]
          const brands = await ownerPool.query(`select id,account_id,brand_name,domain,industry,region,description,competitors
            from public.clients where account_id=$1 order by id`, [user.account_id])
          const brand = brands.rows.find(row => row.id === clientId)
          verifyOwnedFixtureBrand(brand, user, clientId)
          const progress = await ownerPool.query(`select client_id,account_id,prompt_status,draft from public.onboarding_progress
            where client_id=$1 and account_id=$2`, [clientId, user.account_id])
          const prompts = await ownerPool.query(`select count(*)::int as total from public.prompt_bank where client_id=$1`, [clientId])
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify({ brand, clientCount: brands.rowCount, progress: progress.rows, promptCount: prompts.rows[0].total }))
          return
        }
        if (url.pathname === '/__local/persisted') {
          const id = url.searchParams.get('id')
          if (!/^[a-f0-9-]{36}$/.test(id ?? '')) throw new Error('LOCAL_AUTH_ITEM_ID')
          const result = await ownerPool.query(`select id,account_id,client_id,title,action,notes,revision,
            source_kind,source_id,rule_version,check_key,evidence_fingerprint,evidence_snapshot
            from public.evidence_work_items where id=$1`, [id])
          const sources = await ownerPool.query(`select id,account_id,client_id,work_item_id,source_kind,source_id,
            rule_version,check_key,evidence_fingerprint,evidence_snapshot from public.work_item_sources
            where work_item_id=$1 and withdrawn_at is null order by id`, [id])
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify({ rows: result.rows, sources: sources.rows })); return
        }
        if (url.pathname === '/__local/scan') {
          const id = url.searchParams.get('id')
          if (!/^[a-f0-9-]{36}$/.test(id ?? '')) throw new Error('LOCAL_AUTH_SCAN_ID')
          const result = await ownerPool.query(`select id,account_id,client_id,url,domain,score,grade,results
            from public.scans where id=$1`, [id])
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify({ rows: result.rows })); return
        }
        response.writeHead(404); response.end(); return
      }
      if (url.pathname.startsWith('/api/auth/sign-in/magic-link') || url.pathname.startsWith('/api/auth/magic-link/verify')) {
        lastMagicRequestAt = Date.now()
      }
      await handler(request, response)
    } catch (error) {
      record({ event: 'local-auth-service-error', error: error.message })
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: 'LOCAL_AUTH_SERVICE_FAILED' }))
    }
  })
  await new Promise((ready, fail) => {
    server.once('error', fail); server.listen(Number(new URL(config.authOrigin).port), '127.0.0.1', ready)
  })
  return {
    engine,
    async close() {
      mailbox.clear()
      server.closeAllConnections()
      await new Promise(done => server.close(done))
    },
  }
}
