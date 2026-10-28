import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
const headers = `POST /api/outcomes/v1/analytics
Content-Type: application/json
X-AISO-Key-Id: <credential UUID>
X-AISO-Timestamp: <Unix seconds>
X-AISO-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + exact UTF-8 body)>`
const example = { events: [{ eventId: 'analytics:page-a:2026-10-25', occurredAt: '2026-10-25T00:00:00Z', pageUrl: 'https://example.com/a', sessions: 100, conversions: 4, revenueMinor: 12000, currency: 'HKD' }] }
export default async function OutcomeGuide({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  const c = (lang === 'zh-HK' ? zhHK : en).outcomeIntegrations
  return <main className="mx-auto max-w-3xl space-y-6 p-6"><h1 className="text-2xl font-bold">{c.setup}</h1><p>{c.intro}</p><h2 className="font-semibold">{c.credential}</h2><p>{c.credentialHint}</p><p>{c.hookGuide}</p><pre className="overflow-x-auto rounded border p-4">{headers}</pre><pre className="overflow-x-auto rounded border p-4">{JSON.stringify(example,null,2)}</pre><h2 className="font-semibold">{c.indexnow}</h2><p>{c.keyHint}</p><h2 className="font-semibold">{c.deployment}</h2><p>{c.deploymentHint}</p><p>{c.thresholds}</p><h2 className="font-semibold">{c.retrieval}</h2><p>{c.noRetrieval}</p></main>
}
