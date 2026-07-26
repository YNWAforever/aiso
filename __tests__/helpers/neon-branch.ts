import { execFileSync } from 'node:child_process'

export const PROJECT_ID = 'red-firefly-93523049'

function neonctl(args: string[]): string {
  try {
    return execFileSync('neonctl', [...args, '--output', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `neonctl failed: ${detail.replace(/postgresql:\/\/\S+/g, '[redacted]')}\n` +
      'Integration tests need an authenticated neonctl. Run `neonctl auth` and retry.',
    )
  }
}

export type TestBranch = { id: string; connectionUri: string }

export function createTestBranch(name: string): TestBranch {
  const out = neonctl(['branches', 'create', '--project-id', PROJECT_ID, '--name', name])
  const parsed = JSON.parse(out) as {
    branch: { id: string }
    connection_uris?: { connection_uri: string }[]
  }
  const uri = parsed.connection_uris?.[0]?.connection_uri
  if (!uri) throw new Error(`Branch ${name} was created but returned no connection uri`)
  return { id: parsed.branch.id, connectionUri: uri }
}

export function deleteTestBranch(id: string): void {
  neonctl(['branches', 'delete', id, '--project-id', PROJECT_ID])
}
