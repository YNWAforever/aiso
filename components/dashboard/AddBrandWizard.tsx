'use client'
import Link from 'next/link'
import {useTranslations} from 'next-intl'
import {Button} from '@/components/ui/button'
export function AddBrandWizard({lang,disabled,plan}:{lang:string;disabled?:boolean;plan?:string}){
 const t=useTranslations('dashboard')
 if(disabled)return <div className="rounded-xl border-2 border-dashed border-border p-8 text-center"><p>{t('limit_title')}</p><p>{t('limit_body',{plan:plan??'current',allowance:plan==='basic'?t('allowance_basic'):plan==='pro'?t('allowance_pro'):t('allowance_enterprise')})}</p><Button asChild><Link href={`/${lang}/pricing`}>{t('upgrade_enterprise')}</Link></Button></div>
 return <Button variant="ghost" size="sm" asChild><Link href={`/${lang}/onboarding`}>+ {t('add_brand')}</Link></Button>
}
