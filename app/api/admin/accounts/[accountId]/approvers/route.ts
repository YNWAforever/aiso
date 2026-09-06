import { changeApproverAccess, getApproverAccess } from '@/lib/approvals/access-service'

type Context = { params: Promise<{ accountId: string }> }

export async function GET(request: Request, context: Context): Promise<Response> {
  const { accountId } = await context.params
  return getApproverAccess(accountId, new URL(request.url).searchParams)
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { accountId } = await context.params
  return changeApproverAccess(accountId, request)
}
