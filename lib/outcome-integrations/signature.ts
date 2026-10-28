import { createHmac, timingSafeEqual } from 'node:crypto'

/** The exact bounded UTF-8 body is signed, not a reparsed JSON representation. */
export function signOutcomeBody(secret: string, timestamp: string, body: string): string {
  return 'v1=' + createHmac('sha256', secret).update(timestamp + '.').update(body, 'utf8').digest('hex')
}
export function verifyOutcomeSignature(secret: string, timestamp: string, body: string, signature: string, now = Date.now()): boolean {
  if (!/^\d{10}$/.test(timestamp) || Math.abs(now - Number(timestamp) * 1000) > 300_000 || !/^v1=[a-f0-9]{64}$/.test(signature)) return false
  return timingSafeEqual(Buffer.from(signOutcomeBody(secret, timestamp, body).slice(3), 'hex'), Buffer.from(signature.slice(3), 'hex'))
}
