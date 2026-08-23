import { describe, it, expect } from 'vitest'

const FENCED: { path: string; feature: string; methods: string[] }[] = []

describe('fenced routes', () => {
  // Vitest v4 fails a describe block with zero registered `it()` calls
  // ("No test found in suite"), so an empty FENCED needs its own vacuous
  // test rather than just letting the loop below register nothing.
  if (FENCED.length === 0) {
    it('FENCED is empty — no route is currently fenced', () => {
      expect(FENCED).toEqual([])
    })
  } else {
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
  }
})
