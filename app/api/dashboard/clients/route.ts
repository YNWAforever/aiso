import {sanitizeDatabaseError} from '@/lib/observability/database-error'
import {NextRequest,NextResponse} from 'next/server'
import {getProfile} from '@/lib/auth'
import {readLimitedJson} from '@/lib/approvals/request'
import {parseOnboardingInput} from '@/lib/onboarding/schema'
import {completeOnboarding} from '@/lib/onboarding/service'
import {resolveCommercialEntitlement} from '@/lib/tier'
export const dynamic='force-dynamic'
/** Compatibility adapter: durable brand progress, identical validation, no implicit seed context. */
export async function POST(req:NextRequest){
 const profile=await getProfile();if(!profile)return NextResponse.json({error:'Unauthorized'},{status:401})
 let input:ReturnType<typeof parseOnboardingInput>
 try{const raw=await readLimitedJson(req,16384);if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid JSON');const body=raw as Record<string,unknown>;input=parseOnboardingInput({...body,brandName:body.brandName??body.brand_name})}catch{return NextResponse.json({error:'INVALID_BRAND_INPUT'},{status:400})}
 const entitlement=resolveCommercialEntitlement(profile.accounts)
 try{const result=await completeOnboarding({accountId:profile.account_id},input);if(!result)return NextResponse.json({error:'Brand not found'},{status:404});return NextResponse.json({...result,id:result.clientId},{headers:{'Cache-Control':'no-store'}})}catch(error){const message=error instanceof Error?error.message:'';if(message==='ONBOARDING_INTENT_CONFLICT')return NextResponse.json({error:message},{status:409});if(message.includes('BRAND_LIMIT_REACHED'))return NextResponse.json({error:'BRAND_LIMIT_REACHED',plan:entitlement.plan,limit:entitlement.features.max_brands},{status:403});if(message.includes('ACCOUNT_ENTITLEMENT_INVALID'))return NextResponse.json({error:'ACCOUNT_ENTITLEMENT_INVALID'},{status:409});const diagnostic=sanitizeDatabaseError(error,{correlationId:crypto.randomUUID(),route:'/api/dashboard/clients'});console.error({event:'brand_create_database_error',correlationId:diagnostic.correlationId,database:{code:diagnostic.code,category:diagnostic.category}});return NextResponse.json({error:'Failed to create brand'},{status:500})}
}
