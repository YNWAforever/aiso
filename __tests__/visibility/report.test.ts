import { describe, expect, it } from 'vitest'
import { buildVisibilityReport, projectVisibilityObservation } from '@/lib/visibility/report'
const row = {id:'observation',run_id:'run',prompt_id:'query',platform:'gpt-4o',actual_model:'model-1',requested_model:'model-1',finished_at:'2026-10-26T00:00:00Z',raw_answer:'Brand and Other',snapshot:{question:'Which service?',language:'en',market:'HK',monitoring:{intent:'comparison',targetUrl:'https://example.com/a',sampling:{temperature:0.2,samplesPerRun:1,seed:null}}},classification_status:'classified',classification:{brandMentioned:true,sentiment:'positive',competitorsMentioned:['Other']},provider_citations:[{url:'https://source.example/a'},{url:'https://example.com/a'},{url:'https://other.example/a'}],review:null,grounding:'none',search_evidence:{requested:'none',execution:'unknown',basis:'request-only'} }
const context = { domain:'example.com',competitors:[{id:'competitor',name:'Other',domains:['other.example'],aliases:[]}] }
describe('measured AI visibility projections', () => {
  it('counts provider citations and keeps unreviewed recommendation/accuracy unknown', () => {
    expect(projectVisibilityObservation(row,context)).toMatchObject({answerPresence:true,firstCitationPosition:2,citationShare:1/3,recommendation:'unknown',accuracy:'unknown',risk:'unknown',sentiment:'positive',competitorNames:['Other']})
  })
  it('does not infer citations from answer text or sentiment from literal presence', () => {
    expect(projectVisibilityObservation({...row,provider_citations:null,raw_answer:'https://example.com/a',classification_status:'fallback'},context)).toMatchObject({answerPresence:null,citationShare:null,firstCitationPosition:null,sentiment:'unknown'})
  })
  it('does not compute volatility across unknown or changed grounding',()=>{
    const known=projectVisibilityObservation(row,context),other=projectVisibilityObservation({...row,id:'other',grounding:'web',search_evidence:{requested:'web',execution:'confirmed',basis:'provider-search-event'}},context)
    expect(buildVisibilityReport([known,other]).volatility).toBeNull()
    expect(buildVisibilityReport([{...known,grounding:null},{...known,id:'unknown',grounding:null}]).volatility).toBeNull()
  })
  it('reports source gaps, competitor share and context-matched volatility', () => {
    const observations = [projectVisibilityObservation(row,context),projectVisibilityObservation({...row,id:'second',run_id:'run2',finished_at:'2026-10-25T00:00:00Z',classification:{...row.classification,brandMentioned:false}},context)]
    const report=buildVisibilityReport(observations)
    expect(report).toMatchObject({answerPresence:0.5,citationShare:1/3,volatility:1,competitorShareOfVoice:[{name:'Other',share:2/3}]})
    expect(report.trustedSources.map(source=>source.domain)).toContain('source.example')
  })
})
