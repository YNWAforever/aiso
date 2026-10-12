import { expect, it } from 'vitest'
import { formatScanScore } from '@/lib/score-display'
it.each([0,49.97,50,59.97,60,63.5,69.97,70,74,79.97,80,89.97,90,100])('preserves persisted scan score %s', score => {
  expect(formatScanScore(score)).toBe(String(score))
})
it.each([NaN,Infinity,-1,101])('rejects unknown or invalid score %s',score=>{
  expect(()=>formatScanScore(score)).toThrow(RangeError)
})
