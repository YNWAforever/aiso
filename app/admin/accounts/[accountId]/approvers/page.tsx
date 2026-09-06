import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound, redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { getApproverAccess } from '@/lib/approvals/access-service'
import { ApproverAccessWorkspace } from '@/components/approvals/ApproverAccessWorkspace'
export default async function ApproversPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>
  searchParams: Promise<{ lang?: string | string[] }>
}) {
  await requireAdmin()
  const { accountId } = await params,
    query = await searchParams,
    lang = query.lang === 'zh-HK' ? 'zh-HK' : 'en'
  const response = await getApproverAccess(accountId, new URLSearchParams())
  if (response.status === 401) redirect('/en/auth/login')
  if (
    response.status === 404 ||
    response.status === 403 ||
    response.status === 400
  )
    notFound()
  const messages = await getMessages({ locale: lang })
  return (
    <NextIntlClientProvider locale={lang} messages={messages} timeZone="UTC">
      <nav className="flex gap-4 p-4" aria-label="Language">
        <a
          className="inline-flex min-h-11 items-center underline"
          href={'?lang=en'}
          lang="en"
        >
          English
        </a>
        <a
          className="inline-flex min-h-11 items-center underline"
          href={'?lang=zh-HK'}
          lang="zh-HK"
        >
          繁體中文（香港）
        </a>
      </nav>
      <ApproverAccessWorkspace
        accountId={accountId}
        initial={response.ok ? await response.json() : null}
        verified={response.ok}
      />
    </NextIntlClientProvider>
  )
}
