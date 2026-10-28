import 'server-only'
import { OutcomeError } from '@/lib/outcome-integrations/input'
import { db } from '@/lib/db'
import { isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement,type CommercialAccount } from '@/lib/tier'
import { verifyPortalLink } from './signature'
import { publicExecutiveSnapshot,type ExecutiveSnapshot } from './reports'
export async function readPublicPortal(slug:string,locale:string,params:URLSearchParams){
 if(!isFeatureEnabled('enterprise_os')||(locale!=='en'&&locale!=='zh-HK')||[...params.keys()].some(key=>!['v','sig'].includes(key)||params.getAll(key).length!==1))return null
 const raw=params.get('v')??'',signature=params.get('sig')??'',version=Number(raw)
 if(!/^[1-9]\d{0,8}$/.test(raw)||!verifyPortalLink({slug,locale,version,signature}))return null
 try{const sql=db();const [row]=await sql`select s.payload,a.plan,a.status,a.stripe_subscription_id,a.trial_ends_at,a.override_plan,a.override_expires_at
 from enterprise_portals p join enterprise_artifacts s on s.id=p.artifact_id and s.account_id=p.account_id and s.client_id=p.client_id and s.content_hash=p.content_hash
 join enterprise_decisions d on d.artifact_id=s.id and d.account_id=s.account_id and d.client_id=s.client_id and d.content_hash=s.content_hash and d.decision='approved'
 join accounts a on a.id=p.account_id join clients c on c.id=p.client_id and c.account_id=p.account_id
 where p.slug=${slug} and p.version=${version} and p.revoked_at is null and c.status='active' and s.kind='executive_report' and s.payload->>'locale'=${locale}`
 if(!row||!resolveCommercialEntitlement(row as CommercialAccount).features.white_label_portals)return null
 const snapshot=row.payload as ExecutiveSnapshot,proxy=`/api/enterprise/portals/${slug}/logo?v=${version}&sig=${signature}&lang=${locale}`
 return{snapshot:publicExecutiveSnapshot(snapshot,snapshot.branding.logoUrl?proxy:null),logoUrl:snapshot.branding.logoUrl}
 }catch{throw new OutcomeError('ENTERPRISE_UNAVAILABLE',503)}
}
