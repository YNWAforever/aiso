import { appendStudioTurn, finalizeStudioTurn } from '@/lib/conversation-studio/threads'

export async function POST(request: Request, context: RouteContext<'/api/dashboard/clients/[clientId]/studio/threads/[threadId]/turns'>) {
  const { clientId, threadId } = await context.params
  return appendStudioTurn(request, clientId, threadId)
}

export async function PATCH(request: Request, context: RouteContext<'/api/dashboard/clients/[clientId]/studio/threads/[threadId]/turns'>) {
  const { clientId, threadId } = await context.params
  return finalizeStudioTurn(request, clientId, threadId)
}
