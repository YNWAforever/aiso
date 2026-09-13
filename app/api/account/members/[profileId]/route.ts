import { setAccountMemberActive } from '@/lib/members/service'

type Context = { params: Promise<{ profileId: string }> }

// PATCH rather than DELETE, because removal is deactivation and the same call
// puts somebody back: `{ active: false }` removes, `{ active: true }` restores.
// Migration 049 explains why there is no delete. The account is the caller's
// own, resolved from the session inside lib/members/service.ts.
export async function PATCH(request: Request, context: Context): Promise<Response> {
  const { profileId } = await context.params
  return setAccountMemberActive(profileId, request)
}
