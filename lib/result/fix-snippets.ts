/**
 * Starter code shown in a check's drawer. Generic on purpose: they are the
 * same for every site and every viewer, so they reveal nothing about a scan.
 * The Fix Pack produces the site-specific version. Only checks where a short
 * snippet really is the fix have one; the rest are content or server work.
 * Code only, no prose: placeholders use example.com so nothing needs translating.
 */
export const FIX_SNIPPETS: Readonly<Record<string, { language: string; code: string }>> = {
  c1_robots: {
    language: 'robots.txt',
    code: `User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

Sitemap: https://example.com/sitemap.xml`,
  },
  c2_llms_txt: {
    language: 'llms.txt',
    code: `# Example Co

> …

## Pages

- [Services](https://example.com/services)
- [Pricing](https://example.com/pricing)
- [Contact](https://example.com/contact)`,
  },
  c4_structured_data: {
    language: 'html',
    code: `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Example Co",
  "url": "https://example.com",
  "logo": "https://example.com/logo.png",
  "sameAs": ["https://www.linkedin.com/company/example"]
}
</script>`,
  },
  c8_sitemap: {
    language: 'robots.txt',
    code: `Sitemap: https://example.com/sitemap.xml`,
  },
  c9_meta_desc: {
    language: 'html',
    code: `<meta name="description" content="Example Co … (120–160)">`,
  },
  c11_faq: {
    language: 'html',
    code: `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [{
    "@type": "Question",
    "name": "…?",
    "acceptedAnswer": { "@type": "Answer", "text": "…" }
  }]
}
</script>`,
  },
  c12_canonical: {
    language: 'html',
    code: `<link rel="canonical" href="https://example.com/this-page">`,
  },
}
