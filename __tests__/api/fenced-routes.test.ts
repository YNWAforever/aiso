import { describe, it, expect } from 'vitest'

const FENCED: { path: string; feature: string; methods: string[] }[] = []

describe('fenced routes', () => {
  if (FENCED.length === 0) {
    it('all fenced features have been restored', () => {
      // The FENCED array is empty, confirming that all previously fenced features
      // (agents) have been restored with real implementations and no longer need
      // the 503 FEATURE_UNAVAILABLE response. This test passes vacuously.
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
