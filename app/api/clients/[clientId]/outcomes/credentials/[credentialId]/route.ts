import { revokeCredential } from '@/lib/outcome-integrations/service'
export async function DELETE(_request: Request, { params }: { params: Promise<{ clientId: string; credentialId: string }> }) {
  const { clientId, credentialId } = await params
  return revokeCredential(clientId, credentialId)
}
