import { readEnterprise } from '@/lib/enterprise/service'
export const dynamic='force-dynamic'
export async function GET(_request:Request,{params}:{params:Promise<{clientId:string}>}){return readEnterprise((await params).clientId)}
