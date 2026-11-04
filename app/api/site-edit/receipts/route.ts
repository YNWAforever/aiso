import { receiveSiteEditReceipt } from '@/lib/site-edit/receipt-service'

// Site-edit S3: the executor's signed completion receipt. Public by design and
// authenticated only by the receipt HMAC (verifyReceiptSignature, checked over the
// raw body before any database access) — see lib/site-edit/receipt-service.ts.
export async function POST(request: Request) {
  return receiveSiteEditReceipt(request)
}
