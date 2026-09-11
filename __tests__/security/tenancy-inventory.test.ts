import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every SQL statement that touches a tenant-bearing table constrains the tenant,
 * or is declared here with the reason it cannot.
 *
 * Migration `036` dropped all 30 Supabase-era policies and disabled RLS, and the
 * app role keeps `BYPASSRLS` deliberately — so there is no database-level backstop
 * at all. Tenancy is whatever the query text says and nothing else. The owner-loop
 * tables (`041`–`046`) are proven against real Postgres by the five `C9*` suites,
 * but those suites say nothing about the older feature stores — Pulse, the prompt
 * bank, Local Trust, the agent tables, authority overrides — which is exactly what
 * AC-12 still called PARTIAL: "nothing yet proves the negative for the older
 * feature stores".
 *
 * This proves that negative by construction, over every statement in the tree.
 *
 * The naive rule — "every statement must contain `account_id`" — is wrong, and
 * wrong in the direction that matters. Most statements that do not carry the
 * predicate are correct: the account was proven one statement earlier, against
 * `clients` or `scans`, and the second statement then addresses the row by an id
 * that check just validated. So this follows the shape of
 * `__tests__/api/route-gate-inventory.test.ts`: a statement is scoped when its
 * OWN text constrains the account, or when the function it sits in first proves
 * ownership some other way.
 *
 * Scope is the enclosing function rather than the whole file, because file-level
 * would let one gated function vouch for an ungated neighbour — the precise
 * mistake this is looking for.
 */

/**
 * Tables carrying a tenant, and how. The value is documentation, not logic: it
 * records why the table is in this list, so the next person can tell a missing
 * entry from a deliberate omission.
 *
 * Omitted on purpose: `profiles` and `accounts` are addressed by the session's
 * own ids rather than a caller-supplied one, and `schema_migrations`,
 * `cron_runs`, `industry_packs`, `regional_packs` and `plan_features` carry no
 * tenant at all.
 */
const TENANT_TABLES: Record<string, string> = {
  // Direct `account_id` column.
  clients: 'account_id (004)',
  scans: 'account_id (008), client_id (029)',
  account_report_branding: 'account_id (027)',
  client_reports: 'account_id (027)',
  client_report_versions: 'account_id (027)',
  client_entities: 'account_id (040)',
  client_sources: 'account_id (044)',
  client_source_versions: 'account_id (044)',
  evidence_work_items: 'account_id (041)',
  work_item_versions: 'account_id (041)',
  work_item_decisions: 'account_id (042)',
  work_item_delivery_events: 'account_id (043)',
  work_item_export_events: 'account_id (045)',
  account_approver_state: 'account_id (042)',
  account_approver_events: 'account_id (042)',
  authenticated_scan_monthly_usage: 'account_id (025)',
  local_trust_profiles: 'account_id (021)',
  local_trust_snapshots: 'account_id (021)',
  local_trust_actions: 'account_id (021)',
  content_briefs: 'account_id (018)',
  // Tenant through the parent row.
  pulse_metrics: 'client_id -> clients.account_id',
  pulse_weekly_summary: 'client_id -> clients.account_id',
  prompt_bank: 'client_id -> clients.account_id',
  notifications: 'client_id -> clients.account_id',
  agent_competitors: 'scan_id -> scans.client_id -> clients.account_id',
  agent_progress: 'scan_id -> scans.client_id -> clients.account_id',
  agent_recommendations: 'scan_id -> scans.client_id -> clients.account_id',
  authority_overrides: 'client_id (nullable) -> clients.account_id',
  ai_citation_log: 'client_id -> clients.account_id',
  topical_clusters: 'client_id -> clients.account_id',
  chunk_analysis: 'client_id -> clients.account_id',
  domain_signals: 'client_id -> clients.account_id',
  fix_packs: 'scan_id -> scans.account_id',
}

/**
 * Tokens meaning "this function established which account is asking, and that
 * the row it is about to address belongs to that account".
 *
 * Deliberately broad, in the same direction as the route-gate list: a false
 * negative here forces a declaration, which is a conversation; a false positive
 * would silently bless a cross-account read.
 */
const OWNERSHIP_TOKENS = [
  'account_id',                 // the predicate itself, in this or a sibling statement
  'accountId',                  // ...or the value on its way into one
  'authorizeLocalTrustClient',  // lib/localTrust/guard.ts: auth -> entitlement -> ownership
  'assertLocalTrustAccess',
  'authorizePromptBank',        // lib/prompts/guard.ts
  'authorizeClient',
  'loadOwnedReportScan',        // lib/reports/store.ts: ownership proven before the join
  'requireApiAdmin',            // platform-wide by design, and gated as such
  'requireAdmin',
]

/**
 * Statements that do NOT constrain a tenant, each with the reason it is safe.
 * Keyed by `path::function`, which survives edits that shift line numbers.
 *
 * Adding an entry is how a statement becomes cross-account, rather than
 * forgetting a predicate being how it happens.
 */
const DECLARED: Record<string, string> = {
  // ---- Public by design: a scan result is a shareable link. ----
  'app/[lang]/result/[id]/page.tsx::getScan':
    'The public result page. It fetches the row by unguessable uuid for anyone holding the link, ' +
    'and the account is consulted one function later rather than here: ResultPage calls ' +
    'canViewFullResult(scan.account_id, profile?.account_id) and serves buildPublicResultSummary ' +
    'to everyone else. Fetch-then-filter, not filter-then-fetch — deliberate, because the public ' +
    'summary is computed FROM the full row.',
  'app/[lang]/result/[id]/opengraph-image.tsx::Image':
    'The same public page\'s OG card. It renders domain, score and grade, all three of which ' +
    'buildPublicResultSummary already publishes to anonymous viewers of that same id.',
  'app/[lang]/onboarding/page.tsx::OnboardingPage':
    'Pre-fills the wizard from the scan the visitor just ran. Reads domain, industry and region — ' +
    'and buildPublicResultSummary (lib/result-access.ts) already returns all three to any ' +
    'anonymous viewer of /result/[id] for the same id, so this is strictly less than the public ' +
    'page publishes. Narrowing it to unclaimed-or-owned scans would break the anonymous ' +
    'scan -> sign-up -> onboarding funnel it exists to serve, and close nothing.',

  // ---- Cron-authenticated: the system is the caller, so there is no session to scope to. ----
  'app/api/clients/[clientId]/agents/competitors/route.ts::POST':
    'x-cron-secret, not a session — the n8n agent workflow posts results back. No account exists ' +
    'to constrain to; the binding that matters is scan-to-client, which it proves first ' +
    '(select id from scans where id = $scanId and client_id = $clientId) and 404s without.',
  'app/api/clients/[clientId]/agents/progress/route.ts::POST':
    'Same shape and same proof as the competitors route above.',
  'app/api/clients/[clientId]/agents/recommendations/route.ts::POST':
    'Same shape and same proof as the competitors route above. Its scans UPDATE is additionally ' +
    'narrowed to rows still pending, so a replay cannot reopen a completed run.',
  'lib/agents.ts::markCompleteIfAllPresent':
    'Called only by those three routes (grep: no other importer), each after it has bound scanId ' +
    'to clientId. It takes a scanId those callers validated and writes no tenant-visible data — ' +
    'it flips scans.agent_status once all three agent tables have a row.',
  'lib/alerts/neon-store.ts::loadWeeklyRows':
    'Alert evaluation is one bounded pass over every client with an alert config, run by ' +
    'cron/evaluate-alerts. It is cross-account by definition; the clientIds it reads come from ' +
    'configs the same pass selected, never from a caller.',
  'lib/pulse/schedule.ts::countConfiguredClients':
    'Cron scheduling. Returns a single integer — the configuredClients signal that distinguishes ' +
    '"nothing was ever set up" from "nothing was due" — and no row, column or id of any account.',
  'lib/pulse/summary.ts::computeWeeklySummary':
    'The weekly rollup, called once per client from pulse/run (route.ts:250) with a clientId the ' +
    'scheduler selected. That POST resolves the account through the client and checks entitlement ' +
    'before any of this runs — the documented inversion in CLAUDE.md, not an ungated path.',
}

/**
 * Every unscoped statement, declared or not. Pinned because DECLARED is keyed by
 * function: a second unscoped statement added to an already-declared function
 * would otherwise need no new entry and would land unreviewed. This number makes
 * it a visible edit.
 */
const EXPECTED_UNSCOPED_TOTAL = 17

const ROOT = process.cwd()
const BACKSLASH = String.fromCharCode(92)

function sourceFiles(): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next') continue
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.tsx?$/.test(entry)) found.push(path)
    }
  }
  // `lib` and `app` are the request paths. `scripts/` is excluded: those run
  // from an operator's shell against MIGRATE_DATABASE_URL, where holding the
  // owner credential is the authorisation and there is no caller to confuse.
  walk(join(ROOT, 'lib'))
  walk(join(ROOT, 'app'))
  return found.map(p => relative(ROOT, p).split(sep).join('/')).sort()
}

/**
 * Both tagged forms. `const sql = db()` then `` sql`…` `` is the documented one,
 * but 19 statements skip the local and tag the singleton directly — `` db()`…` ``
 * — including every `notifications` query, the three `fix` routes, the alerts
 * route and the public result page. A matcher that knew only the first form
 * would have reported those files as carrying no SQL at all, which is the
 * quietest way for an inventory like this to be wrong.
 */
const TAGS = ['sql`', 'db()`']

/** Tagged SQL templates, tracking `${}` nesting so an interpolation cannot end one early. */
function sqlStatements(source: string): Array<{ index: number; text: string }> {
  const found: Array<{ index: number; text: string }> = []
  for (let i = 0; i < source.length; i++) {
    const tag = TAGS.find(candidate => source.startsWith(candidate, i))
    if (!tag) continue
    if (/[\w.]/.test(source[i - 1] ?? '')) continue // `mysql\`` and friends
    let j = i + tag.length
    let depth = 0
    let text = ''
    while (j < source.length) {
      const char = source[j]!
      if (char === BACKSLASH) { text += source[j]! + (source[j + 1] ?? ''); j += 2; continue }
      if (char === '$' && source[j + 1] === '{') { depth++; text += '${'; j += 2; continue }
      if (char === '}' && depth > 0) { depth--; text += '}'; j++; continue }
      if (char === '`' && depth === 0) break
      text += char
      j++
    }
    found.push({ index: i, text })
    i = j
  }
  return found
}

/**
 * Top-level declarations only — anchored to column 0, which is where this
 * codebase puts them.
 *
 * Anchoring is not a convenience. An unanchored pattern matches the inline arrow
 * in `runQuery(() => sql`…`)` and treats it as a declaration, which cuts the
 * ownership window off just before the statement and reports
 * `lib/reports/store.ts::rows` — a function that does not exist — as unscoped,
 * when the real enclosing function proves ownership on its first line. A nested
 * arrow belongs to the function around it, and so does its tenancy proof.
 */
const FUNCTION_DECLARATION =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\s*=/gm

/** The name of the function a character offset sits inside, by nearest preceding declaration. */
function enclosingFunction(source: string, offset: number): string {
  let name = '(top level)'
  for (const match of source.matchAll(FUNCTION_DECLARATION)) {
    if (match.index! > offset) break
    name = match[1] ?? match[2] ?? name
  }
  return name
}

/** Text from the enclosing declaration to the next one — the window ownership must appear in. */
function functionBody(source: string, offset: number): string {
  let start = 0
  let end = source.length
  for (const match of source.matchAll(FUNCTION_DECLARATION)) {
    if (match.index! <= offset) start = match.index!
    else { end = match.index!; break }
  }
  return source.slice(start, end)
}

type Finding = { key: string; tables: string[]; statement: string }

function unscopedStatements(): Finding[] {
  const findings: Finding[] = []
  for (const file of sourceFiles()) {
    const source = readFileSync(join(ROOT, file), 'utf8')
    if (!TAGS.some(tag => source.includes(tag))) continue
    for (const statement of sqlStatements(source)) {
      const flat = statement.text.replace(/\s+/g, ' ').trim()
      const lowered = flat.toLowerCase()
      const tables = Object.keys(TENANT_TABLES).filter(table =>
        new RegExp(`\\b${table}\\b`).test(lowered),
      )
      if (tables.length === 0) continue
      const scope = functionBody(source, statement.index)
      if (OWNERSHIP_TOKENS.some(token => scope.includes(token))) continue
      findings.push({
        key: `${file}::${enclosingFunction(source, statement.index)}`,
        tables,
        statement: flat.slice(0, 160),
      })
    }
  }
  return findings
}

const FINDINGS = unscopedStatements()
const UNDECLARED = FINDINGS.filter(finding => !DECLARED[finding.key])

describe('every tenant-bearing statement is scoped or declared', () => {
  it('finds the statements at all', () => {
    // A broken walk or a broken extractor would make this suite vacuous while
    // still passing, which is the failure mode it exists to prevent elsewhere.
    const files = sourceFiles()
    expect(files.length).toBeGreaterThan(200)
    expect(files).toContain('app/api/pulse/run/route.ts')

    const statements = files
      .map(file => sqlStatements(readFileSync(join(ROOT, file), 'utf8')).length)
      .reduce((total, count) => total + count, 0)
    expect(statements).toBeGreaterThan(150)
  })

  it('reads both tagged forms', () => {
    // One known statement per form, named outright. Without this, dropping
    // either tag from TAGS would quietly shrink the inventory to nothing and
    // every other assertion here would still pass.
    const fromDbTag = sqlStatements(
      readFileSync(join(ROOT, 'app/[lang]/result/[id]/page.tsx'), 'utf8'),
    ).map(statement => statement.text)
    expect(fromDbTag.join(' ')).toContain('from scans')

    const fromSqlTag = sqlStatements(
      readFileSync(join(ROOT, 'app/api/pulse/run/route.ts'), 'utf8'),
    ).map(statement => statement.text)
    expect(fromSqlTag.join(' ')).toContain('from prompt_bank')
  })

  it('leaves no statement unscoped and undeclared', () => {
    const report = UNDECLARED.map(
      finding => `  ${finding.key}\n    [${finding.tables.join(', ')}] ${finding.statement}`,
    ).join('\n')
    expect(
      UNDECLARED,
      'These statements touch a tenant-bearing table, and neither they nor the function ' +
        'around them constrain the account. Add an account_id predicate, prove ownership first, ' +
        `or declare the entry with the reason it is safe:\n${report}`,
    ).toEqual([])
  })

  it('declares nothing that is now scoped', () => {
    // A declaration that stops describing reality is worse than none: it reads
    // as a reviewed exception while the code below it has moved on.
    const live = new Set(FINDINGS.map(finding => finding.key))
    for (const key of Object.keys(DECLARED)) {
      expect([...live], `${key} is declared cross-account but is now scoped; remove its entry.`).toContain(key)
    }
  })

  it('pins how many statements are unscoped in total', () => {
    // The per-entry list above is keyed by function, so a second unscoped
    // statement added to an already-declared function would not need a new
    // entry. This number does, which is what makes that a visible edit.
    expect(FINDINGS.length).toBe(EXPECTED_UNSCOPED_TOTAL)
  })
})
