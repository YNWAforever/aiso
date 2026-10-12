import { expect, it } from 'vitest'
import { formatScanScore } from '@/lib/score-display'
it.each([0,49.97,50,59.97,60,63.5,69.97,70,74,79.97,80,89.97,90,100])('preserves persisted scan score %s', score => {
  expect(formatScanScore(score)).toBe(String(score))
})
it.each([NaN,Infinity,-1,101])('rejects unknown or invalid score %s',score=>{
  expect(()=>formatScanScore(score)).toThrow(RangeError)
})

import { SCAN_GRADE_BANDS } from '@/lib/score-display'
import { assignGrade } from '@/lib/scoring'
it('covers every legal hundredth exactly once with the scorer grade',()=>{
 for(let n=0;n<=10000;n++) {
  const score=n/100
  const bands=SCAN_GRADE_BANDS.filter(b=>score>=b.minInclusive&&(b.maxExclusive===null||score<b.maxExclusive))
  expect(bands, 'score '+score).toHaveLength(1)
  expect(bands[0].grade).toBe(assignGrade(score))
 }
})
it.each([[59.5,'D'],[69.5,'C'],[79.5,'B'],[89.5,'A']] as const)('keeps decimal %s in grade %s',(score,grade)=>{
 expect(assignGrade(score)).toBe(grade)
 expect(SCAN_GRADE_BANDS.find(b=>score>=b.minInclusive&&(b.maxExclusive===null||score<b.maxExclusive))?.grade).toBe(grade)
})
