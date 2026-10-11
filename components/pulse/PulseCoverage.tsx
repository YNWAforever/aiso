import Link from 'next/link'
import type {PulseCoverageView} from '@/lib/pulse/observed-summary'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
export function PulseCoverage({coverage,lang,href}:{coverage?:PulseCoverageView|null;lang:string;href?:string}){
 if(!coverage)return null
 const c=(lang==='zh-HK'?zh:en).pulseView
 return <div className="mt-3 space-y-2 text-sm text-muted-foreground"><p>{c.classifiedCoverage.replace('{classified}',String(coverage.classified)).replace('{recorded}',String(coverage.recorded))}</p><p>{coverage.expected===null?c.legacyCoverage:c.collectionCoverage.replace('{collected}',String(coverage.collected)).replace('{expected}',String(coverage.expected))}</p>{href&&coverage.classified<coverage.collected&&<Link href={href} className="inline-flex min-h-11 items-center underline">{c.unclassified}</Link>}</div>
}
