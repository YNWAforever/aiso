import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const path = resolve(process.cwd(),'supabase/migrations/041_evidence_work_items.sql')
const sql = () => readFileSync(path,'utf8').replace(/\s+/g,' ').toLowerCase()

describe('evidence work items migration contract', () => {
  it('uses unused migration 041 without modifying historical migrations', () => {
    expect(execFileSync('git',['diff','--name-only','2e22185','--','supabase/migrations/001_*.sql','supabase/migrations/040_*.sql'],{encoding:'utf8'}).trim()).toBe('')
    expect(sql()).toContain('create table public.evidence_work_items')
  })

  it('enforces tenant, actor retention, immutable snapshot bounds and draft-only values', () => {
    const text = sql()
    expect(text).toMatch(/foreign key \(client_id, account_id\) references public\.clients \(id, account_id\) on delete cascade/)
    expect(text.match(/foreign key \((?:created_by|updated_by), account_id\) references public\.profiles \(id, account_id\) on delete set null \((?:created_by|updated_by)\)/g)).toHaveLength(2)
    expect(text).toContain("check (status = 'draft')")
    expect(text).toMatch(/check \(source_kind in \('pulse-metric',\s*'scan-check',\s*'agent-recommendation'\)\)/)
    expect(text).toMatch(/check \(locale in \('en',\s*'zh-hk'\)\)/)
    expect(text).toContain('check (revision > 0)')
    expect(text).toContain('octet_length(evidence_snapshot::text) <= 65536')
    expect(text).toContain('unique (account_id, client_id, opportunity_key)')
    expect(text).not.toMatch(/references public\.(pulse_metrics|scans|agent_recommendations)/)
  })

  it('enforces text, fingerprint and source/check-key combinations', () => {
    const text = sql()
    expect(text).toContain("evidence_fingerprint ~ '^[0-9a-f]{64}$'")
    expect(text).toMatch(/char_length\(btrim\(title\)\) between 1 and 160/)
    expect(text).toMatch(/char_length\(btrim\(action\)\) between 1 and 4000/)
    expect(text).toMatch(/char_length\(notes\) <= 8000/)
    expect(text).toMatch(/check_key in \(\s*'c1_robots',\s*'c2_llms_txt',\s*'c3_bot_access'/)
    expect(text).toMatch(/source_kind = 'scan-check' and check_key is not null/)
    expect(text).toMatch(/source_kind <> 'scan-check' and check_key is null/)
  })

  it('supports stable listing and narrows inherited application privileges', () => {
    const text = sql()
    expect(text).toContain('create index evidence_work_items_account_client_created_idx on public.evidence_work_items (account_id, client_id, created_at desc, id desc)')
    expect(text).toContain('revoke all on public.evidence_work_items from public')
    expect(text).toContain('revoke all on public.evidence_work_items from aeo_app')
    expect(text).toContain('grant select, insert, update on public.evidence_work_items to aeo_app')
  })
})
