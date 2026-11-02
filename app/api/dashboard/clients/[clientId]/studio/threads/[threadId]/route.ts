import { getStudioThread } from '@/lib/conversation-studio/threads'

export async function GET(request: Request, context: RouteContext<'/api/dashboard/clients/[clientId]/studio/threads/[threadId]'>) {
  const { clientId, threadId } = await context.params
  return getStudioThread(request, clientId, threadId)
}
