import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

const workflow = JSON.parse(readFileSync(new URL('../../n8n/aiso-scan-webhook.json', import.meta.url), 'utf8'))
const node = (id: string) => workflow.nodes.find((entry: { id: string }) => entry.id === id)
// Execute the export's expression, rather than duplicating its parameter mapping.
function replacements(id: string, body: Record<string, unknown>, aiSummary = 'synthetic summary'): unknown[] {
  const expression = node(id).parameters.options.queryReplacement
  expect(expression).toBeTypeOf('string')
  return Array.from(runInNewContext(expression.slice(3, -2), {
    $json: { body, ai_summary: aiSummary },
    $: () => ({ first: () => ({ json: { body } }) }),
  }))
}
const first = '10000000-0000-4000-8000-000000000001'
const second = '10000000-0000-4000-8000-000000000002'

describe('retained n8n webhook security', () => {
  it('requires a header credential before workflow execution', () => {
    expect(node('node-webhook').parameters.authentication).toBe('headerAuth')
    expect(node('node-webhook').credentials.httpHeaderAuth.name).toBe('AISO Scan Webhook')
  })

  it('keeps request IDs and model output out of SQL source', async () => {
    const sql = new PGlite()
    try {
      // This is the export's assumed legacy schema, not the repository migration schema.
      await sql.exec(`create table clients(id uuid primary key, brand_name text, email text, webhook_url text);
        create table scans(id uuid primary key, client_id uuid, ai_summary text, updated_at timestamptz);
        insert into clients(id) values ('${first}'),('${second}');
        insert into scans(id,client_id) values ('${first}','${first}'),('${second}','${second}');`)
      const lookup = node('node-get-client').parameters.query
      const update = node('node-update-scan').parameters.query
      expect(lookup).not.toContain('{{')
      expect(update).not.toContain('{{')
      const hostile = `${first}' OR TRUE --`
      await expect(sql.query(lookup, replacements('node-get-client', { clientId: hostile }))).rejects.toThrow(/uuid/)
      await expect(sql.query(update, replacements('node-update-scan', { scanId: hostile, clientId: first }))).rejects.toThrow(/uuid/)
      const summary = "quoted ' summary; UPDATE scans SET ai_summary='injected'; --"
      await sql.query(update, replacements('node-update-scan', { scanId: first, clientId: first }, summary))
      const { rows } = await sql.query<{ id: string; ai_summary: string | null }>('select id,ai_summary from scans order by id')
      expect(rows).toEqual([{ id: first, ai_summary: summary }, { id: second, ai_summary: null }])
      await sql.query(update, replacements('node-update-scan', { scanId: second, clientId: first }, 'wrong client'))
      expect((await sql.query<{ ai_summary: string | null }>('select ai_summary from scans where id=$1', [second])).rows[0].ai_summary).toBeNull()
    } finally { await sql.close() }
  })
})
