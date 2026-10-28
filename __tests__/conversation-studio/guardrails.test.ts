import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('disables Vercel Git deployment for the exact B1 PR branch', () => {
  expect(JSON.parse(readFileSync('vercel.json', 'utf8')).git.deploymentEnabled['codex/conversation-studio-stage-b']).toBe(false)
})
