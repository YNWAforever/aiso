export const workflowCopyKeys=['workflowTitle','workflowNote','workflowObservations','workflowOpportunities','workflowSources'] as const
export type WorkflowCopy=Record<(typeof workflowCopyKeys)[number],string>
export function MaintenanceNextSteps({clientId,lang,current,copy}:{clientId:string;lang:string;current:'observations'|'opportunities'|'sources';copy:WorkflowCopy}){
 const base=`/${lang==='zh-HK'?'zh-HK':'en'}/dashboard/${encodeURIComponent(clientId)}`
 return<section aria-label={copy.workflowTitle} className="mt-8 space-y-3 border-t border-border pt-5"><h2 className="text-lg font-semibold">{copy.workflowTitle}</h2><p className="text-sm">{copy.workflowNote}</p><nav className="flex flex-wrap gap-3" aria-label={copy.workflowTitle}>{(['observations','opportunities','sources'] as const).filter(tool=>tool!==current).map(tool=><a key={tool} className="inline-flex min-h-11 items-center underline" href={`${base}/${tool}`}>{copy[({observations:'workflowObservations',opportunities:'workflowOpportunities',sources:'workflowSources'} as const)[tool]]}</a>)}</nav></section>
}
