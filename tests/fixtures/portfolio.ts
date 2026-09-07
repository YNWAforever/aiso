import type { Portfolio } from '../../lib/view-models/portfolio'
export function portfolioFixture(state: 'ready'|'empty'|'error'|'unknown'|'atLimit'): Portfolio {
  const ready = { state:'ready' as const,observedAt:'2026-09-05',freshness:'unknown' as const }
  return {
    clients: state === 'empty' || state === 'atLimit' ? [] : [{id:'client-a',brand_name:'Example Brand',domain:'example.com',industry:'technology',status:'active',visibility: state === 'ready' ? {...ready,data:{sovScore:25,brandMentions:1,totalQueries:4,platformCount:1,scanWeek:'2026-09-05'}} : {state:state === 'error'?'error':'empty',data:null,observedAt:null,freshness:'unknown'}}],
    history: state === 'ready' ? {...ready,data:[{id:'scan-a',domain:'example.com',score:62,grade:'C',created_at:'2026-09-05T23:30:00.000Z'}]} : {state:state === 'error'?'error':'empty',data:null,observedAt:null,freshness:'unknown'},
    capacity:{state:state === 'unknown'?'unknown':'known',count:state === 'unknown'?null:state === 'atLimit'?3:state === 'empty'?0:1,limit:3,canCreate:state === 'unknown'?null:state !== 'atLimit',plan:'pro'},
  }
}
