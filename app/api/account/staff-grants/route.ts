import { grantStaffAccess, readStaffGrants } from '@/lib/staff-grants/service'

// Studio staff access for the caller's own account, resolved from the session
// inside lib/staff-grants/service.ts. The body names the staff member's email only.
export async function GET(): Promise<Response> {
  return readStaffGrants()
}

export async function POST(request: Request): Promise<Response> {
  return grantStaffAccess(request)
}
