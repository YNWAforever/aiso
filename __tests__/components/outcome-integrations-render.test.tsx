import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { OutcomeWorkspace, type OutcomeView } from '@/components/integrations/OutcomeWorkspace'
const empty: OutcomeView = { technical: null, search: [], analytics: [], appearance: [], clusters: [], clusterOutcomes: [], attempts: [], regressions: [], settings: null }
describe('outcome evidence presentation', () => {
  it('allows checking the preserved submission while its outcome is unknown',()=>{
    const html=renderToStaticMarkup(<OutcomeWorkspace clientId="client" lang="en" initialView={{...empty,settings:{indexnow_key:'12345678abcdef00'}}} initialSubmission={{key:'intent:preserved',urls:['https://example.com/a']}}/>)
    const retry=html.match(/<button([^>]*)>Check saved submission<\/button>/)
    expect(retry).not.toBeNull();expect(retry?.[1]).not.toMatch(/\sdisabled(?:=|\s|$)/)
    expect(html.match(/<textarea[^>]*name="urls"[^>]*>/)?.[0]).toContain('disabled')
  })
  it.each(['en','zh-HK'])('separates evidence classes and renders honest empty/setup states in %s', lang => {
    const html = renderToStaticMarkup(<OutcomeWorkspace clientId="client" lang={lang} initialView={empty}/>)
    for (const text of lang === 'en' ? ['Technical readiness','Observed retrieval','Observed outcomes','No observations','do not prove retrieval'] : ['技術就緒','觀察到的擷取','觀察到的成效','尚無觀察紀錄','不證明已擷取']) {
      expect(html).toContain(text)
    }
    expect(html).not.toMatch(/NaN|undefined|token_ciphertext|rawAnswer/)
    expect(html).toContain('disabled=""')
  })
  it('keeps currencies and uncertain results distinct', () => {
    const view: OutcomeView = { ...empty, analytics: [ {page_url:'https://example.com/a',currency:'HKD',sessions:'25',conversions:'2',revenue_minor:'500'}, {page_url:'https://example.com/a',currency:'USD',sessions:'30',conversions:'1',revenue_minor:'100'} ],
      attempts: [{ id:'1',kind:'indexnow',status:'unknown',started_at:'2026-10-25T00:00:00Z' }], regressions:[{id:'2',state:'not_comparable',created_at:'2026-10-25',evidence:{method:'fimmick-outcome-regression.v1'}}] }
    const html = renderToStaticMarkup(<OutcomeWorkspace clientId="client" lang="en" initialView={view}/>)
    expect(html).toContain('HKD'); expect(html).toContain('USD'); expect(html).toContain('Unknown'); expect(html).toContain('Not comparable')
    expect(html).not.toContain('>600</td>')
  })
})
