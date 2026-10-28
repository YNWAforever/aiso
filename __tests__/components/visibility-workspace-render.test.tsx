import { describe,expect,it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { VisibilityWorkspace } from '@/components/integrations/VisibilityWorkspace'
import type { VisibilityWorkspaceData } from '@/lib/visibility/store'
import { buildVisibilityReport,projectVisibilityObservation } from '@/lib/visibility/report'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
const empty:VisibilityWorkspaceData={clientId:'client',domain:'example.com',queries:[],observations:[],report:buildVisibilityReport([]),drafts:[],jobs:[],autoRetest:false,competitors:[],pageSnapshots:[],sources:[],coverage:{limit:500,limitReached:false,responseLimited:false,source:'accepted-pulse-ledger'}}
describe('bilingual closed-loop workspace',()=>{
 it.each(['en','zh-HK'])('shows honest empty states and explicit automation opt-in in %s',lang=>{
  const c=(lang==='en'?en:zhHK).closedLoopVisibility
  const html=renderToStaticMarkup(<VisibilityWorkspace clientId="client" lang={lang} initialView={empty}/>)
  for(const text of [c.title,c.noObservations,c.emptyQuestions,c.noJobs,c.automationHint,c.schemaHint])expect(html).toContain(text)
  expect(html.match(/<input[^>]*name="enabled"[^>]*>/)?.[0]).not.toContain('checked')
  expect(html).not.toMatch(/NaN|undefined|token_ciphertext/)
 })
 it('keeps unknown measurements unknown and escapes retained answers/draft artifacts',()=>{
  const observation=projectVisibilityObservation({id:'observation',run_id:'run',prompt_id:'query',platform:'gpt-4o',snapshot:{question:'A question',language:null,market:null},raw_answer:'<script>customer()</script>',classification_status:'fallback',provider_citations:null},{domain:'example.com',competitors:[]})
  const view={...empty,observations:[observation],report:buildVisibilityReport([observation]),drafts:[{id:'draft',state:'draft',kind:'technical_patch',artifact:'<script>apply()</script>',created_at:'2026-10-26'}]}
  const html=renderToStaticMarkup(<VisibilityWorkspace clientId="client" lang="en" initialView={view}/>)
  expect(html).toContain('Unknown');expect(html).toContain('&lt;script&gt;customer()&lt;/script&gt;');expect(html).toContain('&lt;script&gt;apply()&lt;/script&gt;')
  expect(html).not.toContain('<script>');expect(html).toContain('Download review artifact')
 })
})
