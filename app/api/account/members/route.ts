import { readMembersPage } from '@/lib/members/service'

// No account parameter, by design: the account is read from the session in
// lib/members/service.ts, so there is no caller-supplied id that could name
// somebody else's workspace.
export async function GET(): Promise<Response> {
  return readMembersPage()
}
