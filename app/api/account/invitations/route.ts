import { inviteAccountMember } from '@/lib/members/service'

// The invited account is the caller's own, resolved from the session inside
// lib/members/service.ts. The body carries only the address and the locale to
// write the mail in.
export async function POST(request: Request): Promise<Response> {
  return inviteAccountMember(request)
}
