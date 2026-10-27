import { mutateAccountEnterpriseRole } from '@/lib/enterprise/roles'
export const dynamic='force-dynamic'
export async function POST(request:Request){return mutateAccountEnterpriseRole(request)}
