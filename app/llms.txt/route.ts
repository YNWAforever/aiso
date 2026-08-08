import { PRODUCT_FACTS } from '@/lib/product-facts'
import { localizedUrl } from '@/lib/seo'

export function GET() {
  const body = `# Fimmick AISO

Fimmick AISO runs ${PRODUCT_FACTS.checkCount} AI readiness checks and scores website evidence out of ${PRODUCT_FACTS.scoreMaximum} points.

## Supported AI platforms
${PRODUCT_FACTS.platforms.map((platform) => `- ${platform}`).join('\n')}

## Fix Pack outputs
${PRODUCT_FACTS.fixPack.map((output) => `- ${output}`).join('\n')}

## Public pages
- ${localizedUrl('en')}
- ${localizedUrl('en', 'pricing')}
- ${localizedUrl('zh-HK')}
- ${localizedUrl('zh-HK', 'pricing')}
`

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
