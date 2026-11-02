import { createStudioThread, listStudioThreads } from '@/lib/conversation-studio/threads'

export async function GET(request: Request, context: RouteContext<'/api/dashboard/clients/[clientId]/studio/threads'>) {
  return listStudioThreads(request, (await context.params).clientId)
}

export async function POST(request: Request, context: RouteContext<'/api/dashboard/clients/[clientId]/studio/threads'>) {
  return createStudioThread(request, (await context.params).clientId)
}
