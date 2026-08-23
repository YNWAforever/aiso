import { describe, it, expect } from 'vitest'

const FENCED: { path: string; feature: string; methods: string[] }[] = [
  { path: '@/app/api/clients/[clientId]/agents/competitors/route', feature: 'agents', methods: ['POST'] },
  { path: '@/app/api/clients/[clientId]/agents/progress/route', feature: 'agents', methods: ['POST'] },
  { path: '@/app/api/clients/[clientId]/agents/recommendations/route', feature: 'agents', methods: ['POST'] },
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
