import { readVisibility } from '@/lib/visibility/service'
export async function GET(_request:Request,{params}:{params:Promise<{clientId:string}>}) {
  return readVisibility((await params).clientId)
}
