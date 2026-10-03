import { previewClientSource } from '@/lib/sources/service'
export async function POST(request:Request,{params}:{params:Promise<{clientId:string}>}){
 const {clientId}=await params
 return previewClientSource(clientId,request)
}
