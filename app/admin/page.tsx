import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth'
import { AdminDirectory } from '@/components/admin/AdminDirectory'
import { parseDirectoryQuery } from '@/lib/admin/directory-schema'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'
import { readAdminSchemaHealth } from '@/lib/admin/schema-health'
import { SchemaHealthPanel } from '@/components/admin/SchemaHealthPanel'

async function SchemaStatus() {
  return <SchemaHealthPanel health={await readAdminSchemaHealth()} />
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin()
  const raw = await searchParams, lang = raw.lang === 'zh-HK' ? 'zh-HK' : 'en'
  const params = new URLSearchParams(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  let query: ReturnType<typeof parseDirectoryQuery>
  try { query = parseDirectoryQuery(params) } catch { notFound() }
  const messages = await getMessages({ locale: lang })
  const t = await getTranslations({ locale: lang, namespace: 'adminDirectory.schemaHealth' })
  return <NextIntlClientProvider locale={lang} messages={messages} timeZone="UTC"><AdminDirectory key={params.toString()} lang={lang} query={query}>
    <Suspense fallback={<p role="status">{t('loading')}</p>}><SchemaStatus /></Suspense>
  </AdminDirectory></NextIntlClientProvider>
}
