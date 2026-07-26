import { describe, it, expect } from 'vitest'

const FENCED: { path: string; feature: string; methods: string[] }[] = [
  { path: '@/app/api/pulse/onboard/route', feature: 'pulse', methods: ['POST'] },
  { path: '@/app/api/pulse/run/route', feature: 'pulse', methods: ['POST'] },
  { path: '@/app/api/pulse/suggest-questions/route', feature: 'pulse', methods: ['POST'] },
  { path: '@/app/api/pulse/[clientId]/summary/route', feature: 'pulse', methods: ['GET'] },
  { path: '@/app/api/pulse/[clientId]/missed/route', feature: 'pulse', methods: ['GET'] },
  { path: '@/app/api/fix/cluster-map/route', feature: 'content-tools', methods: ['POST'] },
  { path: '@/app/api/fix/content-brief/route', feature: 'content-tools', methods: ['POST'] },
  { path: '@/app/api/clients/[clientId]/agents/competitors/route', feature: 'agents', methods: ['POST'] },
  { path: '@/app/api/clients/[clientId]/agents/progress/route', feature: 'agents', methods: ['POST'] },
  { path: '@/app/api/clients/[clientId]/agents/recommendations/route', feature: 'agents', methods: ['POST'] },
  { path: '@/app/api/notifications/route', feature: 'notifications', methods: ['GET'] },
  { path: '@/app/api/notifications/read-all/route', feature: 'notifications', methods: ['PUT'] },
  { path: '@/app/api/dashboard/clients/[clientId]/alerts/route', feature: 'alerts', methods: ['GET', 'PUT'] },
  { path: '@/app/api/dashboard/clients/[clientId]/prompts/route', feature: 'prompt-bank', methods: ['GET', 'POST'] },
  { path: '@/app/api/dashboard/clients/[clientId]/prompts/[promptId]/route', feature: 'prompt-bank', methods: ['PATCH', 'DELETE'] },
  { path: '@/app/api/dashboard/clients/[clientId]/local-trust/export/route', feature: 'local-trust', methods: ['GET'] },
  { path: '@/app/api/cron/trial-emails/route', feature: 'trial-emails', methods: ['GET'] },
  { path: '@/app/api/cron/evaluate-alerts/route', feature: 'alerts', methods: ['POST'] },
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
