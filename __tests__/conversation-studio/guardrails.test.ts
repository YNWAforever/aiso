import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

it('disables Vercel Git deployment for the exact B1 PR branch', () => {
  expect(JSON.parse(readFileSync('vercel.json', 'utf8')).git.deploymentEnabled['codex/conversation-studio-stage-b']).toBe(false)
})

it('disables B2 deployment and gives the exact live route a bounded function duration', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
  expect(config.git.deploymentEnabled['codex/conversation-studio-stage-b2']).toBe(false)
  expect(config.functions['app/api/dashboard/clients/[clientId]/studio/answer/route.ts'].maxDuration).toBe(30)
})

it('disables the exact 6h branch without changing existing deployment entries', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
  expect(config.git.deploymentEnabled['codex/conversation-studio-stage-6h']).toBe(false)
  expect(config.git.deploymentEnabled['codex/conversation-studio-keep-dev-kd3']).toBe(false)
  expect(config.git.deploymentEnabled['codex/aiso-full-remediation-20261003']).toBe(false)
})

it('disables deployment for the exact Stage 6g branch without changing other entries', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
  expect(config.git.deploymentEnabled['codex/conversation-studio-stage-6g']).toBe(false)
  expect(config.git.deploymentEnabled['codex/conversation-studio-stage-b2']).toBe(false)
  expect(config.regions).toEqual(['sin1'])
})

it('disables deployment for the exact Stage 6a branch without changing other entries', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
  expect(config.git.deploymentEnabled['codex/conversation-studio-stage-6a']).toBe(false)
  expect(config.git.deploymentEnabled['codex/conversation-studio-stage-6g']).toBe(false)
  expect(config.git.deploymentEnabled['codex/conversation-studio-stage-6h']).toBe(false)
})


it('disables deployment for the exact Stage 6d, 6e and 6f branches and keeps the 25-key set', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
  expect(config.git.deploymentEnabled['codex/conversation-studio-stage-6d']).toBe(false)
  expect(config.git.deploymentEnabled['codex/conversation-studio-stage-6e']).toBe(false)
  expect(config.git.deploymentEnabled['codex/conversation-studio-stage-6f']).toBe(false)
  expect(config.git.deploymentEnabled['codex/conversation-studio-stage-6c']).toBe(false)
  expect(config.git.deploymentEnabled['codex/conversation-studio-stage-6h']).toBe(false)
  expect(config.git.deploymentEnabled['codex/conversation-studio-default-home']).toBe(false)
  expect(Object.keys(config.git.deploymentEnabled)).toHaveLength(25)
  expect(config.functions).not.toHaveProperty('app/api/dashboard/clients/[clientId]/studio/search-console/route.ts')
})

it('uses the durable account-week honesty strings from the Hazel pack', () => {
  expect(en.conversationStudio.featureShellNote).toBe(
    'Studio is available. Live model answers stay off until LIVE is enabled; work from saved evidence and templates meanwhile.',
  )
  expect(en.conversationStudio.live.temporaryCap).toBe(
    'Weekly LIVE answers use your account quota for this brand. The count persists across restarts and instances.',
  )
  expect(zh.conversationStudio.live.temporaryCap).toBe(
    '即時回答使用此品牌帳戶的每週配額；計數會跨重啟及執行個體保留。',
  )
  expect(JSON.stringify(en.conversationStudio.live)).not.toMatch(/process-local|per process|this process|responding process/i)
  expect(JSON.stringify(zh.conversationStudio.live)).not.toMatch(/程序|執行個體獨立/)
})
