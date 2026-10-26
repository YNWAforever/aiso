import { describe,expect,it } from 'vitest'
import { projectVisibilityObservation } from '@/lib/visibility/report'
import { generateVisibilityArtifact } from '@/lib/visibility/artifacts'
import type { VisibilityPage } from '@/lib/visibility/page'
const observation=projectVisibilityObservation({id:'observation',run_id:'run',prompt_id:'query',platform:'gpt-4o',actual_model:'model',finished_at:'2026-10-25T00:00:00Z',raw_answer:'A competitor answer',snapshot:{question:'Which service?',language:'en',market:'HK',monitoring:{targetUrl:'https://example.com/a',expectedAttributes:['Evidence']}},classification_status:'classified',classification:{brandMentioned:false},provider_citations:[{url:'https://source.example/a'}]},{domain:'example.com',competitors:[]})
const page:VisibilityPage={url:'https://example.com/a',observedAt:'2026-10-25T00:00:00Z',method:'visibility-page.v1',collection:'complete',httpStatus:200,canonicalState:'missing',noindex:false,titlePresent:true,contentHash:'a'.repeat(64),limitations:[]}
describe('measured gap review artifacts',()=>{
 it.each(['en','zh-HK'])('creates a sourced review brief without fabricated facts in %s',locale=>{
  const artifact=generateVisibilityArtifact(observation,'brief',locale)
  expect(artifact).toContain('source.example');expect(artifact).toContain('https://example.com/a');expect(artifact).toContain(locale==='en'?'nothing is applied':'不會自動套用')
 })
 it('generates a minimal WebPage schema without invented FAQ or rating claims',()=>{
  const schema=JSON.parse(generateVisibilityArtifact(observation,'schema','en'))
  expect(schema).toEqual({'@context':'https://schema.org','@type':'WebPage','@id':'https://example.com/a#webpage',url:'https://example.com/a',inLanguage:'en'})
 })
 it('allows a measured answer-absence brief even when citation collection is unknown',()=>{
  expect(generateVisibilityArtifact({...observation,citationsRecorded:false,citations:[]},'brief','en')).toContain('Brand presence: absent')
 })
 it('requires an actually inspected page gap for an actual review-only patch',()=>{
  expect(()=>generateVisibilityArtifact(observation,'technical_patch','en')).toThrow('VISIBILITY_TECHNICAL_GAP_UNVERIFIED')
  expect(()=>generateVisibilityArtifact(observation,'technical_patch','en',{...page,canonicalState:'present'})).toThrow()
  const patch=generateVisibilityArtifact(observation,'technical_patch','en',page)
  expect(patch).toContain('diff --git');expect(patch).toContain('+<link rel="canonical" href="https://example.com/a">')
  expect(patch).not.toContain('noindex')
 })
})
