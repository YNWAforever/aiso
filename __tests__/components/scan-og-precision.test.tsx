import { beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildScanEvidence } from '@/lib/scan-evidence'
import { assignGrade } from '@/lib/scoring'
const state=vi.hoisted(()=>({rows:[] as unknown[],html:''}))
vi.mock('@/lib/db',()=>({db:()=>async()=>state.rows}))
vi.mock('next/og',()=>({ImageResponse:class {constructor(element: Parameters<typeof renderToStaticMarkup>[0]) {state.html=renderToStaticMarkup(element)}}}))
import Image from '@/app/[lang]/result/[id]/opengraph-image'
beforeEach(()=>{state.rows=[];state.html=''})
const evidence=buildScanEvidence({requestedUrl:'https://example.invalid',evaluatedUrl:'https://example.invalid',industry:null,region:null,sitemapSource:'unknown',checks:{},observations:[{check:'page',collection:'complete',httpStatus:200,target:{origin:'https://example.invalid'}}]})
it.each([49.97,59.97,63.5,69.97,79.97,89.97,0,100])('shares the persisted score and true grade %s',async score=>{
 state.rows=[{domain:'example.invalid',score:String(score),grade:assignGrade(score),results:{evidence},industry:null,region:null}]
 await Image({params:Promise.resolve({lang:'en',id:'synthetic-scan'})})
 expect(state.html).toContain('>'+score+'</div>')
 expect(state.html).toContain('>'+assignGrade(score)+'</div>')
})
it('does not turn an absent score into zero',async()=>{
 state.rows=[{domain:'example.invalid',score:null,grade:null,results:{evidence},industry:null,region:null}]
 await Image({params:Promise.resolve({lang:'en',id:'synthetic-scan'})})
 expect(state.html).not.toContain('Website readiness score')
 expect(state.html).not.toContain('>0</div>')
})
