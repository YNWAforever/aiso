import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth'
import { AdminDirectory } from '@/components/admin/AdminDirectory'
import { parseDirectoryQuery } from '@/lib/admin/directory-schema'
import { notFound } from 'next/navigation'

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin()
  const raw = await searchParams, lang = raw.lang === 'zh-HK' ? 'zh-HK' : 'en'
  const params = new URLSearchParams(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  let query: ReturnType<typeof parseDirectoryQuery>
  try { query = parseDirectoryQuery(params) } catch { notFound() }
  const messages = await getMessages({ locale: lang })
  return <NextIntlClientProvider locale={lang} messages={messages} timeZone="UTC"><AdminDirectory key={params.toString()} lang={lang} query={query} /></NextIntlClientProvider>
}
