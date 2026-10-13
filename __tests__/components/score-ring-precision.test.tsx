import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ScoreRing } from '@/components/ScoreRing'
it.each([49.97,59.97,63.5,69.97,79.97,89.97,0,50,60,70,80,90,100])('keeps dashboard scan score %s', score => {
  expect(renderToStaticMarkup(<ScoreRing score={score} />)).toContain('>'+String(score)+'</div>')
})
