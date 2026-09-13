import { checkDomainVerification, readDomainVerification } from '@/lib/domain-verification/service'

type Context = { params: Promise<{ clientId: string }> }

// GET hands back the token and where to publish it; POST goes and looks.
// The account comes from the session inside the service — the clientId is
// caller-supplied, so ownership is a predicate on the query, not a check.
export async function GET(_request: Request, context: Context): Promise<Response> {
  const { clientId } = await context.params
  return readDomainVerification(clientId)
}

export async function POST(_request: Request, context: Context): Promise<Response> {
  const { clientId } = await context.params
  return checkDomainVerification(clientId)
}
