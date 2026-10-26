import { publicEnterpriseApi } from '@/lib/enterprise/service'
export const dynamic='force-dynamic'
async function handle(request:Request,{params}:{params:Promise<{id:string;resource:string}>}){const{id,resource}=await params;return publicEnterpriseApi(request,id,resource)}
export { handle as GET,handle as POST }
