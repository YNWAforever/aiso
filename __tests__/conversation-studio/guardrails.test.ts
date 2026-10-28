import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('disables Vercel Git deployment for the exact B1 PR branch', () => {
  expect(JSON.parse(readFileSync('vercel.json', 'utf8')).git.deploymentEnabled['codex/conversation-studio-stage-b']).toBe(false)
})

it('disables B2 deployment and gives the exact live route a bounded function duration', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
  expect(config.git.deploymentEnabled['codex/conversation-studio-stage-b2']).toBe(false)
  expect(config.functions['app/api/dashboard/clients/[clientId]/studio/answer/route.ts'].maxDuration).toBe(30)
})
