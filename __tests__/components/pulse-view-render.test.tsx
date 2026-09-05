import { afterAll, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ObservedPulseView } from '@/components/pulse/ObservedPulseView'
import { SovChart } from '@/components/pulse/SovChart'
import type { PulseView } from '@/lib/view-models/pulse'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
function fixture(state:'ready'|'empty'|'error'):PulseView{return {client:{id:'owned-client',brand_name:'Fixture brand'},observations:{state,latestKpi:null,latestWeek:state==='ready'?'2026-09-06':null,series:state==='ready'?[{platform:null,points:[{week:'2026-08-23',sov:0},{week:'2026-08-30',sov:null},{week:'2026-09-06',sov:null}]},{platform:'openai',points:[{week:'2026-08-23',sov:25},{week:'2026-08-30',sov:null},{week:'2026-09-06',sov:null}]}]:[]},prompts:{state,data:state==='ready'?[{id:'p1',question:'Which local service is suitable?',category:'brand_query',language:'en',is_active:true}]:[]},missed:{state,data:state==='ready'?[{platform:'openai',question:'Which local service is suitable?',competitors_mentioned:['Other brand'],scan_week:'2026-08-23'}]:[]}}}
const render=(state:'ready'|'empty'|'error',lang:string)=>renderToStaticMarkup(<main className="mx-auto max-w-5xl p-6"><h1>{(lang==='en'?en:zh).pulseView.title}</h1><ObservedPulseView view={fixture(state)} lang={lang}/></main>)
it.each(['en','zh-HK'])('preserves observed zero and unavailable gaps in %s',lang=>{const copy=(lang==='en'?en:zh).pulseView;const html=render('ready',lang);expect(html).toContain('0%');expect(html).toContain(copy.unknown);expect(html).toContain(copy.gaps);expect(html).toContain('25%');expect(html).toContain(copy.freshness);expect(render('empty',lang)).not.toContain('0%');expect(render('error',lang)).toContain(copy.error);expect(render('error',lang)).not.toContain('0%')})
it('does not connect null observations in the rendered chart',()=>{const tree=SovChart({data:[{week:'2026-09-06',sov:null}]});const chart=tree.props.children[1].props.children.props.children;const line=chart.props.children[3];expect(line.props.connectNulls).toBe(false);expect(chart.props.data[0].sov).toBeNull()})
afterAll(()=>{const dir=process.env.C8C_HTML_DIR;if(!dir)return;mkdirSync(dir,{recursive:true});for(const lang of ['en','zh-HK']){writeFileSync(join(dir,`${lang}-copy.json`),JSON.stringify((lang==='en'?en:zh).pulseView));for(const state of ['ready','empty','error'] as const)writeFileSync(join(dir,`${lang}-${state}.html`),render(state,lang))}})
