import { describe, it, expect } from 'vitest'

const FENCED: { path: string; feature: string; methods: string[] }[] = [
  { path: '@/app/api/pulse/onboard/route', feature: 'pulse', methods: ['POST'] },
  // pulse/run is restored — see __tests__/api/pulse-run.test.ts. The rest of
  // Pulse stays fenced: they are read routes with no producer-side work done.
  { path: '@/app/api/pulse/[clientId]/summary/route', feature: 'pulse', methods: ['GET'] },
  { path: '@/app/api/pulse/[clientId]/missed/route', feature: 'pulse', methods: ['GET'] },
  { path: '@/app/api/fix/cluster-map/route', feature: 'content-tools', methods: ['POST'] },
  { path: '@/app/api/fix/content-brief/route', feature: 'content-tools', methods: ['POST'] },
  { path: '@/app/api/clients/[clientId]/agents/competitors/route', feature: 'agents', methods: ['POST'] },
  { path: '@/app/api/clients/[clientId]/agents/progress/route', feature: 'agents', methods: ['POST'] },
  { path: '@/app/api/clients/[clientId]/agents/recommendations/route', feature: 'agents', methods: ['POST'] },
  { path: '@/app/api/cron/trial-emails/route', feature: 'trial-emails', methods: ['GET'] },
]

describe('fenced routes', () => {
  for (const { path, feature, methods } of FENCED) {
    for (const method of methods) {
      it(`${path} ${method} returns 503 FEATURE_UNAVAILABLE`, async () => {
        const mod = await import(path)
        const handler = mod[method]
        expect(handler, `${path} must still export ${method}`).toBeTypeOf('function')
        const res = await handler()
        expect(res.status).toBe(503)
        await expect(res.json()).resolves.toEqual({ error: 'FEATURE_UNAVAILABLE', feature })
      })
    }
  }
})
