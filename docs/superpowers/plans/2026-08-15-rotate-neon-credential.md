# Rotate the Leaked Neon Credential Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the exposed `neondb_owner` password everywhere it is used, and make the class of leak that exposed it impossible to repeat silently.

**Architecture:** The rotation itself is a human-only operation — an agent must never read, type, or paste the password. This plan therefore splits into two halves: code that an agent builds and tests (a shared secret redactor, a `neonctl` wrapper that pipes every byte through it, a connectivity prover that never prints a DSN), and a runbook the human executes with that tooling in hand. The redactor is a pure function, so it is fully TDD-able; the runbook is the only place credentials are handled.

**Tech Stack:** TypeScript 5.9, Node 24/25 (native type stripping for `scripts/*.ts`), Vitest 4, `@neondatabase/serverless`, `neonctl`, Vercel CLI.

---

## Read this before you start

**What happened.** `neonctl branches create` printed a full connection URI — password included — to stdout, into an agent transcript. Neon branch roles are inherited from the parent, so the exposed password is the **production** `neondb_owner` password for Neon project `AEOGEO` (`red-firefly-93523049`, org `org-soft-sunset-25251479`, branch `production` = `br-rough-butterfly-aojtgi92`).

**Treat it as compromised.** It appeared in a transcript that may be retained, synced, or included in a session export. Rotate it, do not merely hope.

**The agent must never handle the password.** Tasks 1–5 and 7 are agent work and involve no credential. **Task 6 is human-only**: it resets the Neon password and pastes the new DSN into Vercel, `.env.local`, and n8n. If you are an agent executing this plan, stop at Task 6, hand it to the human, and resume at Task 7 once they confirm. Do not offer to "just run it" — entering a password on someone's behalf is out of bounds regardless of who asks.

**Rotation breaks things until every consumer is updated.** The full inventory is in Task 5's runbook; the non-obvious one is **n8n**, which stores a Postgres credential built from this same DSN (`n8n/configure-credentials.sh`). Nothing in the app will tell you n8n is broken — its workflows just start failing.

**Out of scope, deliberately:** the separate n8n bearer JWT still reachable in git history at `bcbe9dc`. That is a different credential with its own rotation, long owed, and mixing the two makes both harder to verify. Do it next, not here.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/security/redact-secrets.ts` | Pure `redactSecrets(text)` — the single definition of what a secret looks like in output. No imports, so plain `node` can load it from `scripts/`. | Create |
| `__tests__/lib/redact-secrets.test.ts` | Proves the redactor against the exact shapes that leaked | Create |
| `scripts/redact.mjs` | stdin → stdout filter wrapping the redactor, for piping any command's output | Create |
| `scripts/neon` | Executable wrapper: runs `neonctl` with all output piped through `redact.mjs` | Create |
| `__tests__/scripts/neon-wrapper.test.ts` | Asserts the wrapper exists, is executable, and cannot be bypassed | Create |
| `scripts/verify-db-connection.mjs` | Proves `DATABASE_URL` connects and reports host + identity, never the DSN | Create |
| `scripts/migrate.ts` | Replace the weak inline `postgresql://`-only redaction with the shared one | Modify |
| `docs/runbooks/rotate-neon-credential.md` | The human-executed rotation runbook and consumer inventory | Create |
| `CLAUDE.md` | Secrets Hygiene section gains the wrapper rule and the neonctl hazards | Modify |

**Commands used throughout** (run from the repo root):

```bash
npx vitest run __tests__/path/to/file.test.ts
```

```bash
npm run lint
```

```bash
npm run typecheck
```

Use `npm run test:unit` once at the end, not for per-task iteration.

---

### Task 1: The shared secret redactor

**Files:**
- Create: `lib/security/redact-secrets.ts`
- Test: `__tests__/lib/redact-secrets.test.ts`

This must have **no imports at all**, including no type imports from `@/`. `scripts/redact.mjs` loads it by relative path under plain `node`, which strips types but cannot resolve the `@/` alias.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/redact-secrets.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { redactSecrets } from '@/lib/security/redact-secrets'

describe('redactSecrets', () => {
  it('redacts the password from a connection URI but keeps the host', () => {
    // The exact shape that leaked: neonctl branches create printed this to stdout.
    const line = 'postgresql://neondb_owner:npg_yxgMD67vcGVS@ep-lively-wildflower-aoit3bpm.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require'

    const out = redactSecrets(line)

    expect(out).not.toContain('npg_yxgMD67vcGVS')
    // The host is diagnostic, not secret — losing it makes output useless for
    // the one thing it is good for, telling you which database you are on.
    expect(out).toContain('ep-lively-wildflower-aoit3bpm')
    expect(out).toContain('neondb_owner')
    expect(out).toContain(':***@')
  })

  it('redacts regardless of URI scheme', () => {
    for (const scheme of ['postgres', 'postgresql', 'https', 'redis']) {
      const out = redactSecrets(`${scheme}://user:hunter2@host.example/db`)
      expect(out, scheme).not.toContain('hunter2')
      expect(out, scheme).toContain('host.example')
    }
  })

  it('redacts a bare Neon password token with no URI around it', () => {
    // Defence in depth: neonctl also prints tokens outside a URI, and the
    // migrate runner's old regex only matched a full postgresql:// URI.
    const out = redactSecrets('password: npg_yxgMD67vcGVS')
    expect(out).not.toContain('npg_yxgMD67vcGVS')
    expect(out).toContain('npg_***')
  })

  it('redacts a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const out = redactSecrets(`authorization:Bearer ${jwt}`)
    expect(out).not.toContain(jwt)
    expect(out).toContain('***jwt***')
  })

  it('redacts every occurrence on a line, not just the first', () => {
    const out = redactSecrets(
      'a=postgres://u:p1@h1/db b=postgres://u:p2@h2/db',
    )
    expect(out).not.toContain('p1')
    expect(out).not.toContain('p2')
  })

  it('leaves output with no secrets untouched', () => {
    const clean = 'Applied 6 migration(s).'
    expect(redactSecrets(clean)).toBe(clean)
  })

  it('handles multi-line input, which is what a piped command produces', () => {
    const out = redactSecrets('line one\npostgres://u:secret@h/db\nline three')
    expect(out).not.toContain('secret')
    expect(out.split('\n')).toHaveLength(3)
  })

  it('is a no-op on empty input rather than throwing', () => {
    expect(redactSecrets('')).toBe('')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/lib/redact-secrets.test.ts`

Expected: FAIL at module load — `Failed to resolve import "@/lib/security/redact-secrets"`. All eight tests fail together.

- [ ] **Step 3: Write the redactor**

Create `lib/security/redact-secrets.ts`:

```ts
/**
 * Strip credentials from arbitrary command or error output.
 *
 * Deliberately dependency-free and side-effect-free: `scripts/redact.mjs` loads
 * this by relative path under plain `node`, which strips types but cannot
 * resolve the `@/` alias. Adding any import here breaks the wrapper that pipes
 * neonctl through it.
 *
 * Hosts are kept. They are the only diagnostically useful part of a connection
 * URI, and knowing which endpoint you are pointed at is what stops someone
 * seeding production by accident.
 */

/** `scheme://user:password@` — any scheme, password optional. */
const URI_CREDENTIALS = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^\s:@/]+)(?::[^\s@/]*)?@/g

/** Neon role passwords and API keys travel as bare `npg_…` tokens. */
const NEON_TOKEN = /\bnpg_[A-Za-z0-9]{8,}\b/g

/** Three base64url segments — a JWT, such as the n8n bearer token. */
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g

export function redactSecrets(text: string): string {
  return text
    .replace(URI_CREDENTIALS, '$1$2:***@')
    .replace(NEON_TOKEN, 'npg_***')
    .replace(JWT, '***jwt***')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/lib/redact-secrets.test.ts`

Expected: PASS, 8 tests.

- [ ] **Step 5: Confirm plain node can load it, which the wrapper depends on**

Run:

```bash
node -e "import('./lib/security/redact-secrets.ts').then(m => console.log(m.redactSecrets('postgres://u:p@h/db')))"
```

Expected: prints `postgres://u:***@h/db`. If this errors on module resolution, an import crept into the file — remove it rather than working around it in the wrapper.

- [ ] **Step 6: Commit**

```bash
git add lib/security/redact-secrets.ts __tests__/lib/redact-secrets.test.ts
git commit -m "feat(security): add a shared secret redactor for command output"
```

---

### Task 2: The neonctl wrapper

**Files:**
- Create: `scripts/redact.mjs`
- Create: `scripts/neon`
- Test: `__tests__/scripts/neon-wrapper.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/scripts/neon-wrapper.test.ts`:

```ts
import { execFileSync } from 'node:child_process'
import { accessSync, constants, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const WRAPPER = join(process.cwd(), 'scripts/neon')
const FILTER = join(process.cwd(), 'scripts/redact.mjs')

describe('scripts/redact.mjs', () => {
  it('redacts a connection URI piped through stdin', () => {
    const out = execFileSync('node', [FILTER], {
      input: 'postgresql://neondb_owner:npg_yxgMD67vcGVS@ep-x.aws.neon.tech/neondb\n',
      encoding: 'utf8',
    })

    expect(out).not.toContain('npg_yxgMD67vcGVS')
    expect(out).toContain('ep-x.aws.neon.tech')
  })

  it('passes clean output through unchanged', () => {
    const out = execFileSync('node', [FILTER], { input: 'all good\n', encoding: 'utf8' })
    expect(out).toBe('all good\n')
  })
})

describe('scripts/neon', () => {
  it('is executable', () => {
    // A wrapper nobody can run is a wrapper nobody will use.
    expect(() => accessSync(WRAPPER, constants.X_OK)).not.toThrow()
  })

  it('routes both stdout and stderr through the redactor', () => {
    // neonctl prints the connection URI on stdout for `branches create` and
    // the driver echoes DSNs on stderr, so redirecting only one is a hole.
    const src = readFileSync(WRAPPER, 'utf8')

    expect(src).toContain('redact.mjs')
    expect(src).toMatch(/2>&1/)
  })

  it('fails loudly rather than silently printing raw output if the filter is missing', () => {
    const src = readFileSync(WRAPPER, 'utf8')
    expect(src).toMatch(/set -euo pipefail/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/scripts/neon-wrapper.test.ts`

Expected: FAIL — `ENOENT` for `scripts/redact.mjs` in the first describe, and for `scripts/neon` in the second.

- [ ] **Step 3: Write the filter**

Create `scripts/redact.mjs`:

```js
#!/usr/bin/env node
// stdin -> stdout filter that strips credentials. Pipe any command through it:
//   some-command 2>&1 | node scripts/redact.mjs
import { redactSecrets } from '../lib/security/redact-secrets.ts'

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { buffer += chunk })
process.stdin.on('end', () => { process.stdout.write(redactSecrets(buffer)) })
```

- [ ] **Step 4: Write the wrapper**

Create `scripts/neon`:

```bash
#!/usr/bin/env bash
# neonctl, with every byte of output run through the secret redactor.
#
# Use this instead of bare `neonctl`. `neonctl branches create` prints a full
# connection URI including the password to stdout, and because Neon branch roles
# are inherited from the parent, that password is the parent's -- so a single
# unredacted branch creation discloses the production credential.
#
# Known neonctl hazard this does NOT fix: `connection-string --branch-id <id>`
# returns the PARENT's endpoint, not the branch's. Always assert the host you
# got is the one you meant before writing anything.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
neonctl "$@" 2>&1 | node "${here}/redact.mjs"
```

Then make it executable:

```bash
chmod +x scripts/neon
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run __tests__/scripts/neon-wrapper.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 6: Prove it against the real failure mode**

Run:

```bash
printf 'postgresql://neondb_owner:npg_TESTTESTTEST@ep-y.aws.neon.tech/neondb\n' | node scripts/redact.mjs
```

Expected output exactly:

```
postgresql://neondb_owner:***@ep-y.aws.neon.tech/neondb
```

- [ ] **Step 7: Commit**

```bash
git add scripts/redact.mjs scripts/neon __tests__/scripts/neon-wrapper.test.ts
git commit -m "feat(security): wrap neonctl so its output cannot leak a DSN"
```

---

### Task 3: Route the migration runner through the shared redactor

**Files:**
- Modify: `scripts/migrate.ts` (the `catch` block near the end that currently inlines its own regex)
- Test: `__tests__/scripts/migrate-redaction.test.ts`

`scripts/migrate.ts` currently does `String(err.message).replace(/postgresql:\/\/\S+/g, '[redacted]')`. That misses `postgres://` (no `ql`), misses bare `npg_` tokens, and throws away the host along with the password. Replace it with the shared function.

- [ ] **Step 1: Write the failing test**

Create `__tests__/scripts/migrate-redaction.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { redactSecrets } from '@/lib/security/redact-secrets'

const SOURCE = readFileSync(join(process.cwd(), 'scripts/migrate.ts'), 'utf8')

describe('migrate.ts failure output', () => {
  it('uses the shared redactor rather than its own regex', () => {
    expect(SOURCE).toContain('redactSecrets')
    // The old inline pattern only matched postgresql:// and dropped the host.
    expect(SOURCE).not.toContain("replace(/postgresql:\\/\\/\\S+/g")
  })

  it('the shared redactor covers what the old regex missed', () => {
    // postgres:// without the "ql" — the driver emits both spellings.
    expect(redactSecrets('postgres://u:leaked@h/db')).not.toContain('leaked')
    // A bare token, which no URI-shaped regex would ever match.
    expect(redactSecrets('npg_ABCDEFGH12345')).not.toContain('npg_ABCDEFGH12345')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/scripts/migrate-redaction.test.ts`

Expected: FAIL on the first test — `expected '…' to contain 'redactSecrets'`. The second test passes already, since Task 1 landed the redactor.

- [ ] **Step 3: Change the runner**

In `scripts/migrate.ts`, add this import alongside the existing imports at the top of the file:

```ts
import { redactSecrets } from '../lib/security/redact-secrets.ts'
```

Then find the failure handler containing:

```ts
    console.error('Migration failed:', String(err.message).replace(/postgresql:\/\/\S+/g, '[redacted]'))
```

and replace that single line with:

```ts
    console.error('Migration failed:', redactSecrets(String(err.message)))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/scripts/migrate-redaction.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 5: Confirm the runner still executes**

Run: `node scripts/migrate.ts --help 2>&1 | head -5`

Expected: the runner's usage output, with no module-resolution error. If it fails to resolve the import, the relative path is wrong — `scripts/migrate.ts` is one level below the repo root, so `../lib/...` is correct.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate.ts __tests__/scripts/migrate-redaction.test.ts
git commit -m "refactor(security): redact migration failures with the shared redactor"
```

---

### Task 4: A connectivity prover that never prints a DSN

**Files:**
- Create: `scripts/verify-db-connection.mjs`
- Test: `__tests__/scripts/verify-db-connection.test.ts`

This is what Task 6 runs before and after rotation to prove the new credential works, and what Task 7 uses to confirm nothing regressed. It must print enough to be useful (which host, which database, which role, whether the schema is intact) and nothing that is secret.

- [ ] **Step 1: Write the failing test**

Create `__tests__/scripts/verify-db-connection.test.ts`:

```ts
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SCRIPT = join(process.cwd(), 'scripts/verify-db-connection.mjs')
const SOURCE = readFileSync(SCRIPT, 'utf8')

describe('verify-db-connection', () => {
  it('never prints the DSN itself', () => {
    // The whole point of the script is to be safe to run with output shared.
    expect(SOURCE).not.toMatch(/console\.log\([^)]*DATABASE_URL/)
    expect(SOURCE).toContain('redactSecrets')
  })

  it('reports the host so the operator can tell which database answered', () => {
    expect(SOURCE).toContain('hostname')
  })

  it('exits non-zero with a clear message when DATABASE_URL is unset', () => {
    let code = 0
    let output = ''
    try {
      output = execFileSync('node', [SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      const e = error as { status: number; stdout: string; stderr: string }
      code = e.status
      output = `${e.stdout}${e.stderr}`
    }

    expect(code).not.toBe(0)
    expect(output).toMatch(/DATABASE_URL/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/scripts/verify-db-connection.test.ts`

Expected: FAIL at module load — `ENOENT` reading `scripts/verify-db-connection.mjs`.

- [ ] **Step 3: Write the script**

Create `scripts/verify-db-connection.mjs`:

```js
#!/usr/bin/env node
// Prove DATABASE_URL connects, and report which database answered.
// Safe to run with the output pasted into a ticket: no DSN, no password.
//
//   node --env-file=.env.local scripts/verify-db-connection.mjs
import { neon } from '@neondatabase/serverless'

import { redactSecrets } from '../lib/security/redact-secrets.ts'

const dsn = process.env.DATABASE_URL
if (!dsn) {
  console.error('DATABASE_URL is not set. Pass --env-file=.env.local, or export it.')
  process.exit(1)
}

let url
try {
  url = new URL(dsn)
} catch {
  console.error('DATABASE_URL is not a valid URL.')
  process.exit(1)
}

console.log('host    :', url.hostname)
console.log('database:', url.pathname.replace(/^\//, ''))
console.log('role    :', url.username)

try {
  const sql = neon(dsn)
  const [row] = await sql`
    select
      current_user                                                   as role,
      current_database()                                             as db,
      (select count(*) from public.schema_migrations)                as migrations,
      (select count(*) from public.accounts)                         as accounts,
      (select count(*) from public.clients)                          as clients`
  console.log('connected: yes')
  console.log('server   :', { role: row.role, db: row.db })
  console.log('schema   :', {
    migrations: row.migrations,
    accounts: row.accounts,
    clients: row.clients,
  })
  process.exit(0)
} catch (error) {
  console.error('connected: NO')
  console.error(redactSecrets(String(error?.message ?? error)))
  process.exit(1)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/scripts/verify-db-connection.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 5: Run it for real against the current credential**

Run:

```bash
node --env-file=.env.local scripts/verify-db-connection.mjs
```

Expected: `connected: yes`, host `ep-dawn-glade-aoio1qs6…`, role `neondb_owner`, and non-zero counts for `migrations`. **Record this output** — Task 6 compares against it after rotation, and a changed schema count means something other than the password moved.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-db-connection.mjs __tests__/scripts/verify-db-connection.test.ts
git commit -m "feat(security): add a DSN-safe connection verifier"
```

---

### Task 5: The rotation runbook

**Files:**
- Create: `docs/runbooks/rotate-neon-credential.md`

The runbook is the deliverable a human follows in Task 6. Write it now, while the consumer inventory is fresh; execute it in Task 6.

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/rotate-neon-credential.md`:

```markdown
# Runbook: rotate the Neon `neondb_owner` password

**When to run this:** the connection string has been disclosed — pasted into a
transcript, a log, a ticket, a screenshot — or on a scheduled rotation.

**Who runs it:** a human with Neon console access and Vercel project access.
An agent must not perform any step that reads or types the password.

**Blast radius:** every consumer below breaks the moment the old password is
revoked, and stays broken until updated. Do the whole list in one sitting.

## Consumer inventory

| Consumer | Where | How it is updated |
|---|---|---|
| Vercel deployment | `DATABASE_URL` env var, **per project and per environment** (production / preview / development) | Vercel dashboard, or `vercel env` |
| Local development | `.env.local` at the repo root | Edit the file |
| MCP servers | `.mcp.json` interpolates `${DATABASE_URL}` from the shell | Whatever exports it (shell profile / direnv) |
| n8n | A stored **Postgres credential** built from this DSN by `n8n/configure-credentials.sh` | Re-run that script with the new `DATABASE_URL` |
| Integration tests | Read `DATABASE_URL` at run time | Inherited from `.env.local`; nothing separate |

> There may be **more than one Vercel project** bound to this database. One is
> `fimmick-aeo-oitb`; the project backing the live domain has historically been
> under a different login. Enumerate projects before you start, and update every
> one — a project you forget is a production outage you find out about later.

## Procedure

1. **Record the pre-rotation baseline.**

       node --env-file=.env.local scripts/verify-db-connection.mjs

   Save the output. The schema counts must be identical afterwards; only the
   credential is changing.

2. **Enumerate every Vercel project bound to this database**, and for each, every
   environment that defines `DATABASE_URL`. Write the list down before changing
   anything.

3. **Reset the password** in the Neon console: project `AEOGEO`
   (`red-firefly-93523049`), branch `production`, role `neondb_owner` → reset
   password. Copy the new connection string into your password manager first, not
   into a terminal, a chat, or a file you will forget.

   Do not use `neonctl` for this step. Use the console — `neonctl` prints
   connection URIs to stdout, which is the failure mode that caused this
   rotation.

4. **Update every consumer from the inventory**, in this order so the window
   where things are broken is shortest:
   - Vercel env vars for every project and environment, then redeploy each.
   - `.env.local`.
   - Whatever exports `DATABASE_URL` into your shell for `.mcp.json`.
   - Re-run `n8n/configure-credentials.sh` with the new `DATABASE_URL`.

5. **Verify locally.**

       node --env-file=.env.local scripts/verify-db-connection.mjs

   Expect `connected: yes` and the same schema counts as step 1.

6. **Verify each deployment** by exercising a route that touches the database and
   confirming a 200 rather than a 500.

7. **Verify both crons still authenticate and run.** They are the consumers least
   likely to be noticed if broken, because they fire weekly:
   `/api/cron/pulse` (Mondays 04:17 UTC) and `/api/cron/evaluate-alerts`
   (Mondays 07:47 UTC). Either wait for the next Monday and confirm a 200 in the
   deployment logs, or trigger each once manually with its documented auth shape.

8. **Confirm the old password is dead.** Attempt a connection with the previous
   DSN and expect authentication failure. If it still works, the reset did not
   take effect and you are not rotated.

## Prevention

Use `scripts/neon` instead of bare `neonctl`. It pipes stdout and stderr through
`scripts/redact.mjs`, so a printed connection URI comes out as
`postgresql://neondb_owner:***@host…`.

Two neonctl behaviours to keep in mind, neither of which the wrapper can fix:

- `neonctl branches create` prints the full connection URI, password included,
  to stdout. Branch roles are inherited, so that is the parent's password.
- `neonctl connection-string --branch-id <id>` returns the **parent's** endpoint,
  not the branch's. A DSN obtained that way can point at production while you
  believe you are on a throwaway branch. Always assert the host before writing.
```

- [ ] **Step 2: Verify the runbook's own commands are real**

Run: `node --env-file=.env.local scripts/verify-db-connection.mjs`

Expected: the command in step 1 of the runbook works exactly as written. A runbook whose first command is wrong will not be trusted for the rest.

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/rotate-neon-credential.md
git commit -m "docs: add the Neon credential rotation runbook"
```

---

### Task 6: Execute the rotation (HUMAN ONLY — agents stop here)

**Files:** none. This task changes secrets, not code.

> **Agents: do not perform this task.** It requires reading and entering a
> password. Hand this plan to the human, point them at
> `docs/runbooks/rotate-neon-credential.md`, and wait for them to confirm before
> starting Task 7. Do not offer to run any part of it, and do not ask the user to
> paste the new connection string to you — you do not need it and must not have it.

- [ ] **Step 1: Human runs the runbook**

Follow every step of `docs/runbooks/rotate-neon-credential.md`, including the
step-8 check that the old password no longer authenticates.

- [ ] **Step 2: Human confirms completion**

Confirm to the agent (or record here) that: the password is reset, every Vercel
project and environment is updated and redeployed, `.env.local` is updated, the
shell export for MCP is updated, the n8n credential is re-created, and the old
password is confirmed dead.

---

### Task 7: Post-rotation verification and documentation

**Files:**
- Modify: `CLAUDE.md` (the Secrets Hygiene section)

Run this only after the human confirms Task 6 is complete.

- [ ] **Step 1: Confirm the new credential works and the data is unchanged**

Run: `node --env-file=.env.local scripts/verify-db-connection.mjs`

Expected: `connected: yes`, role `neondb_owner`, and the same `migrations` /
`accounts` / `clients` counts recorded in Task 4 Step 5. Different counts mean
you are pointed at a different database, not a rotated one — stop and work out
which before going further.

- [ ] **Step 2: Confirm the migration ledger still reads clean**

Run: `npm run migrate -- --verify`

Expected: every migration `001`–`035` reports `recorded`, with the two known
benign entries — `014` reports `plan_features` MISSING because `028` drops it on
purpose, and column-only migrations report `n/a`.

- [ ] **Step 3: Update the Secrets Hygiene section**

In `CLAUDE.md`, find the Secrets Hygiene section and add these two bullets to it:

```markdown
- **Use `scripts/neon`, never bare `neonctl`.** It pipes stdout and stderr through
  `scripts/redact.mjs` (`lib/security/redact-secrets.ts`). This exists because
  `neonctl branches create` prints a full connection URI *including the password*
  to stdout, and Neon branch roles are inherited from the parent — so creating a
  throwaway branch discloses the production credential. That happened on
  2026-08-15 and forced a rotation; see
  `docs/runbooks/rotate-neon-credential.md`.
- **`neonctl connection-string --branch-id <id>` returns the PARENT's endpoint,**
  not the branch's — verified directly. A DSN obtained that way points at
  production while you believe you are on a throwaway branch. Assert the hostname
  is the one you intended before any write. `redactSecrets` deliberately keeps
  hosts for exactly this reason.
```

- [ ] **Step 4: Run the full suite, lint and typecheck**

Run: `npm run test:unit`

Expected: PASS, every file. This plan adds four test files; the total grows by
their test count from the pre-plan baseline of 136 files / 1515 tests.

Run: `npm run lint`

Expected: exits 0, no output. This repo holds lint at 0 errors and 0 warnings.

Run: `npm run typecheck`

Expected: exits 0, no output.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record the neonctl leak hazards in secrets hygiene"
```

---

## What this plan deliberately does not do

- **It does not rotate the n8n bearer JWT** still reachable at `bcbe9dc`, which has
  no `exp` claim and never self-expires. That rotation is genuinely owed, but it is
  a different credential in a different system, and bundling them makes it harder to
  confirm either one actually landed. Do it immediately after this.
- **It does not introduce a least-privilege database role.** Running the app as
  something other than `neondb_owner` is the durable fix for blast radius, but it
  would activate the 21 dead Supabase-era RLS policies that call `auth.uid()` — a
  function that does not exist under Neon — and silently return zero rows almost
  everywhere. Those policies must be dropped first; that is its own plan.
- **It does not scrub the exposed password from existing transcripts or history.**
  Rotation makes the disclosed value worthless, which is the reliable remedy;
  chasing every copy is not.
