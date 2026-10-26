import { mutateEnterprise } from '@/lib/enterprise/service'
export const dynamic='force-dynamic'
export async function POST(request:Request,{params}:{params:Promise<{clientId:string;action:string}>}){const{clientId,action}=await params;return mutateEnterprise(clientId,action,request)}
