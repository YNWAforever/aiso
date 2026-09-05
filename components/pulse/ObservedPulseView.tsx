import {SovChart} from './SovChart'
import type {PulseView} from '@/lib/view-models/pulse'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
export function ObservedPulseView({view,lang}:{view:PulseView;lang:string}){
 const copy=(lang==='zh-HK'?zhHK:en).pulseView;const observed=view.observations
 const panel='min-w-0 rounded-xl border border-border bg-card p-5'
 return <div className="min-w-0 space-y-5 break-words">
  <p className="text-sm text-muted-foreground">{copy.intro}</p>
  <section className={panel}><h2 className="text-xl font-bold text-foreground">{copy.aggregate}</h2><p className="mt-2 text-sm text-muted-foreground">{copy.week}: {observed.latestWeek??copy.unknown} · {copy.freshness}</p>
   <p className="my-4 text-2xl font-bold text-foreground">{observed.state==='error'?copy.error:observed.latestKpi?`${observed.latestKpi.sovScore}%`:copy.empty}</p>
   {observed.state==='ready'&&observed.series[0]&&<SovChart data={observed.series[0].points} lang={lang}/>}
  </section>
  {observed.state==='ready'&&observed.series.slice(1).map(series=><section key={series.platform} className={panel}><h2 className="text-lg font-bold text-foreground">{series.platform}</h2><SovChart data={series.points} lang={lang} label={series.platform??copy.aggregate}/></section>)}
  <section className={panel}><h2 className="text-lg font-bold text-foreground">{copy.prompts}</h2>
   {view.prompts.state!=='ready'?<p className="mt-3 text-sm text-muted-foreground">{view.prompts.state==='error'?copy.error:copy.empty}</p>:<ul className="mt-3 space-y-3">{view.prompts.data.map(prompt=><li key={prompt.id} className="text-sm text-foreground">{prompt.question}<span className="ml-2 text-xs text-muted-foreground">{prompt.is_active?copy.active:copy.inactive}</span></li>)}</ul>}
  </section>
  <section className={panel}><h2 className="text-lg font-bold text-foreground">{copy.missed}</h2>
   {view.missed.state!=='ready'?<p className="mt-3 text-sm text-muted-foreground">{view.missed.state==='error'?copy.error:copy.empty}</p>:<ul className="mt-3 space-y-4">{view.missed.data.map((row,index)=><li key={`${row.platform}-${index}`} className="text-sm text-foreground"><p>{row.question}</p><p className="mt-1 text-xs text-muted-foreground">{row.platform} · {row.scan_week}</p><p className="mt-1 text-xs text-muted-foreground">{copy.competitors}: {row.competitors_mentioned.join(', ')||'—'}</p></li>)}</ul>}
  </section>
 </div>
}
