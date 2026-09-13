import { revokeAccountInvitation } from '@/lib/members/service'

type Context = { params: Promise<{ invitationId: string }> }

// The id comes from the caller, so lib/members/store.ts puts the account into
// the UPDATE itself rather than checking ownership first: a row that is not
// this account's simply does not match, and the service answers 404.
export async function DELETE(_request: Request, context: Context): Promise<Response> {
  const { invitationId } = await context.params
  return revokeAccountInvitation(invitationId)
}
