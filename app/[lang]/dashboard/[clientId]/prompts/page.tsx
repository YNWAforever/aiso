// app/[lang]/dashboard/[clientId]/prompts/page.tsx
import { redirect } from 'next/navigation'

export default async function PromptsPage({
  params,
}: {
  params: Promise<{ lang: string; clientId: string }>
}) {
  const { lang, clientId } = await params
  redirect(`/${lang}/pulse/${clientId}#question-bank`)
}
