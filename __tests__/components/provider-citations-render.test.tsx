import {describe,it,expect} from 'vitest'
import {renderToString} from 'react-dom/server'
import {ObservationDetailContent} from '@/components/observations/ObservationDetail'
import {projectObservationDetail} from '@/lib/observations/schema'
import type {ObservationCopy} from '@/components/observations/copy'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const row={id:'22222222-2222-4222-8222-222222222222',prompt_id:null,question:'Question',platform:'chatgpt',scan_week:'2026-10-05',
  created_at:null,raw_answer:'Sample answer',brand_mentioned:null,snapshot:null,brand_snapshot:null,requested_model:null,actual_model:null,
  collector:null,collector_version:null,provider_request_id:null,classifier_method:null,classifier_version:null,sentiment:null,matched_text:null}

describe('citation provenance rendering',()=>{
  it.each([en,zh])('shows received citations without claiming they were not recorded',messages=>{
    const copy=messages.observations as ObservationCopy
    const observation=projectObservationDetail({...row,provider_citations:[{url:'https://source.example/',title:'<script>unsafe</script>'}],provider_finish_reason:'stop'})
    const html=renderToString(<ObservationDetailContent observation={observation} copy={copy}/> )
    expect(html).toContain(copy.providerCitation)
    expect(html).not.toContain(copy.noProviderCitations)
    expect(html).not.toContain('<script>unsafe')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain(copy.providerComplete)
  })
})
