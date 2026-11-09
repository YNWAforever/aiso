import { getStudioThread, updateStudioThread } from '@/lib/conversation-studio/threads'

export async function GET(request: Request, context: RouteContext<'/api/dashboard/clients/[clientId]/studio/threads/[threadId]'>) {
  const { clientId, threadId } = await context.params
  return getStudioThread(request, clientId, threadId)
}

/** Rename / pin / archive / share. Owner only; a shared teammate reads via GET. */
export async function PATCH(request: Request, context: RouteContext<'/api/dashboard/clients/[clientId]/studio/threads/[threadId]'>) {
  const { clientId, threadId } = await context.params
  return updateStudioThread(request, clientId, threadId)
}
