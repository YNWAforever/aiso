import Link from 'next/link'
import {notFound} from 'next/navigation'
import {requireAuth} from '@/lib/auth'
import {loadOwnedPulse} from '@/lib/workspace/load-owned-pulse'
import {buildPulseView} from '@/lib/view-models/pulse'
import {ObservedPulseView} from '@/components/pulse/ObservedPulseView'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
export default async function PulsePage({params}:{params:Promise<{lang:string;clientId:string}>}){
 const {lang,clientId}=await params;const profile=await requireAuth(lang);const copy=(lang==='zh-HK'?zhHK:en).pulseView
 let owned
 try{owned=await loadOwnedPulse({clientId,profile})}catch{return <main className="px-6 py-12"><h1 className="text-xl font-bold">{copy.loadError}</h1><p className="mt-3">{copy.error}</p></main>}
 if(!owned)notFound()
 return <main className="mx-auto w-full min-w-0 max-w-4xl px-4 py-8 sm:px-6"><h1 className="mb-4 text-2xl font-bold">{owned.client.brand_name} · {copy.title}</h1><Link href={`/${lang}/dashboard/${clientId}?step=monitor`} className="mb-5 inline-flex min-h-11 items-center text-sm text-primary-accessible underline">{copy.back}</Link><Link href={`/${lang}/dashboard/${clientId}/prompts`} className="mb-5 ml-4 inline-flex min-h-11 items-center text-sm text-primary-accessible underline">{copy.prompts}</Link><ObservedPulseView view={buildPulseView(owned)} lang={lang}/></main>
}
