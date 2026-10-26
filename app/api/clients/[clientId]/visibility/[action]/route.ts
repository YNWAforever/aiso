import { mutateVisibility } from '@/lib/visibility/service'
export async function POST(request:Request,{params}:{params:Promise<{clientId:string;action:string}>}) {
  const {clientId,action}=await params
  return mutateVisibility(clientId,action,request)
}
