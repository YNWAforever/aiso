import { changeStaffAccess } from '@/lib/staff-grants/service'

type Context = { params: Promise<{ grantId: string }> }

// The grant id comes from the caller, so the store puts the session's account
// inside the UPDATE: another account's grant simply does not match (404).
export async function PATCH(_request: Request, context: Context): Promise<Response> {
  const { grantId } = await context.params
  return changeStaffAccess(grantId, 'renew')
}

export async function DELETE(_request: Request, context: Context): Promise<Response> {
  const { grantId } = await context.params
  return changeStaffAccess(grantId, 'revoke')
}
