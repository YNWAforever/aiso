import { answerStudio } from '@/lib/conversation-studio/live'

export async function POST(request: Request, context: RouteContext<'/api/dashboard/clients/[clientId]/studio/answer'>) {
  return answerStudio(request, (await context.params).clientId)
}
