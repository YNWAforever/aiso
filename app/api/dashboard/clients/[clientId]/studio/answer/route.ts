import { answerStudioStream } from '@/lib/conversation-studio/live'

export async function POST(request: Request, context: RouteContext<'/api/dashboard/clients/[clientId]/studio/answer'>) {
  // Returns SSE only when the client asked for it and the streaming flag is on;
  // every other case is the unchanged buffered JSON response.
  return answerStudioStream(request, (await context.params).clientId)
}
