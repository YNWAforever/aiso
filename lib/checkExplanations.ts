export interface CheckExplanation {
  why: string
  fix: { pass: string; warn: string; fail: string }
}

export const CHECK_EXPLANATIONS: Record<string, CheckExplanation> = {
  c1_robots: {
    why: 'AI crawlers like GPTBot, ClaudeBot and PerplexityBot check robots.txt before fetching any page. Blocking them means your content is invisible to every AI search engine.',
    fix: {
      pass: 'AI bots are explicitly permitted — no action needed.',
      warn: 'Add explicit Allow rules for the major AI bots. The Fix Pack below includes a ready-to-use robots.txt patch.',
      fail: 'Create or update /robots.txt to permit AI crawlers. Use the Fix Pack below to generate the correct patch.',
    },
  },
  c2_llms_txt: {
    why: 'llms.txt is the AI equivalent of sitemap.xml — it tells every AI platform what your site covers, who you are, and which pages are most important to cite.',
    fix: {
      pass: 'Your llms.txt is present — no action needed.',
      warn: 'Your llms.txt exists but has no content. Add a title, description and key URLs using the Fix Pack below.',
      fail: 'Create /llms.txt at your domain root. The Fix Pack below generates a complete file tailored to your site.',
    },
  },
  c3_bot_access: {
    why: 'Even if robots.txt allows bots, network-level blocks (Cloudflare, WAF rules, geo-fencing) can prevent AI crawlers from fetching your pages at all.',
    fix: {
      pass: 'All tested AI bots can access your site — no action needed.',
      warn: 'Some AI bots are being blocked at the network level. Check your CDN/WAF rules for bot-management settings and whitelist the affected user agents.',
      fail: 'AI bots cannot reach your site. Review your firewall, Cloudflare Bot Management, or server rules to allow GPTBot, ClaudeBot and PerplexityBot.',
    },
  },
  c4_structured_data: {
    why: 'JSON-LD schema markup gives AI models machine-readable context about your content — what type of page it is, who wrote it, and what it\'s about. Pages without schema are cited less often.',
    fix: {
      pass: 'JSON-LD schema found — no action needed.',
      warn: 'Only microdata was found. Migrate to JSON-LD, which AI models parse more reliably. The Fix Pack includes a FAQ JSON-LD starting point.',
      fail: 'No structured data found. Add JSON-LD schema to your pages. The Fix Pack below generates a FAQ schema to get you started.',
    },
  },
  c5_extractability: {
    why: 'AI models can only cite text they can read. If your content is locked inside JavaScript components that require execution to render, it may never be indexed.',
    fix: {
      pass: 'Content is extractable — no action needed.',
      warn: 'Limited extractable text was found. Move more content into server-rendered HTML rather than client-side JavaScript.',
      fail: 'Very little extractable text found. Your page likely relies heavily on JavaScript to render. Switch to server-side rendering (SSR) for key content.',
    },
  },
  c6_llms_full_txt: {
    why: 'A minimal llms.txt (just the file, no real content) gives AI models little signal. A well-structured file with a description and multiple URL entries significantly improves how AI platforms understand your site.',
    fix: {
      pass: 'Your llms.txt has good depth — no action needed.',
      warn: 'Your llms.txt exists but is sparse. Add a `#` title line, a `>` description block, and at least 5 key page URLs.',
      fail: 'No usable llms.txt content found. Use the Fix Pack below to generate a complete file.',
    },
  },
  c7_mcp_card: {
    why: 'Emerging AI platforms check /.well-known/ai.json for structured information about your site. Early adoption signals AI-readiness and may give you an edge as this standard becomes mainstream.',
    fix: {
      pass: 'AI metadata endpoint found — no action needed.',
      warn: 'AI meta tags were found but no formal endpoint. Create /.well-known/ai.json with your site name, description and contact.',
      fail: 'No AI metadata found. Create /.well-known/ai.json. See the Fimmick docs for a minimal template.',
    },
  },
  c8_sitemap: {
    why: 'AI crawlers use your sitemap to discover and prioritise which pages to index. Without one, they may miss your most important content entirely.',
    fix: {
      pass: 'Sitemap found with good coverage — no action needed.',
      warn: 'Sitemap found but has very few URLs. Ensure all key pages are listed and the sitemap is referenced in robots.txt.',
      fail: 'No sitemap found. Generate /sitemap.xml and reference it in robots.txt with `Sitemap: https://yourdomain.com/sitemap.xml`.',
    },
  },
  c9_meta_desc: {
    why: 'The meta description is often used verbatim by AI platforms when summarising your page. A concise, accurate description (50–160 characters) increases the chance of your summary being cited.',
    fix: {
      pass: 'Meta description is well-formed — no action needed.',
      warn: 'Meta description length is outside the ideal range. Target 50–160 characters that clearly summarise the page\'s purpose.',
      fail: 'No meta description found. Add `<meta name="description" content="…">` to every key page.',
    },
  },
  c10_headings: {
    why: 'AI models use heading hierarchy to understand the structure of your content. One clear H1 and multiple H2 subheadings make it easy to extract distinct, citable chunks of information.',
    fix: {
      pass: 'Heading hierarchy is clear — no action needed.',
      warn: 'Heading structure is shallow. Add H2 subheadings to break your content into clearly labelled sections.',
      fail: 'No H1 found. Every page must have exactly one H1 that describes the page topic, followed by H2 section headings.',
    },
  },
  c11_faq: {
    why: 'FAQ pages with FAQPage JSON-LD schema are cited 3× more often by AI search engines because they directly answer question-format queries. Even 3 well-written Q&As make a significant difference.',
    fix: {
      pass: 'FAQPage schema found — no action needed.',
      warn: 'FAQ content detected but no FAQPage JSON-LD schema. Add schema markup so AI models can parse and cite your answers. The Fix Pack below generates the code.',
      fail: 'No FAQ content or schema found. Add a FAQ section and FAQPage JSON-LD to at least your homepage and key landing pages. Use the Fix Pack to generate the schema.',
    },
  },
  c12_canonical: {
    why: 'Canonical tags tell AI crawlers which version of a page is authoritative. Without them, crawlers may split authority across duplicate URLs (e.g. with/without trailing slash, http vs https).',
    fix: {
      pass: 'Canonical URL is correctly set — no action needed.',
      warn: 'Canonical tag points to a different origin. Verify this is intentional (e.g. cross-domain canonical). If not, update it to point to this page\'s URL.',
      fail: 'No canonical tag found. Add `<link rel="canonical" href="https://yourdomain.com/page">` to every page.',
    },
  },
  c13_render: {
    why: 'AI crawlers typically do not execute JavaScript. If your page text only appears after JS runs, crawlers see a near-empty page and have nothing to cite.',
    fix: {
      pass: 'Content is rich in server-rendered HTML — no action needed.',
      warn: 'Moderate server-rendered text detected. Move more key content out of client-side components into SSR/SSG templates.',
      fail: 'Very little server-rendered text found. Switch to server-side rendering (Next.js SSR/SSG, Nuxt, etc.) for all content that should be indexed and cited.',
    },
  },
  c14_internal_links: {
    why: 'Internal links signal content relationships to AI crawlers and help them discover all your pages. Sites with dense internal linking are indexed more completely.',
    fix: {
      pass: 'Strong internal linking — no action needed.',
      warn: 'Few internal links found. Add contextual links between related pages, especially from high-traffic pages to deeper content.',
      fail: 'Very few internal links. Build a deliberate internal linking structure: at least 10 links from your homepage to key pages, and cross-links between related articles.',
    },
  },
  c15_entity: {
    why: 'Organization and Person schema markup tells AI models who is behind the content, increasing trustworthiness signals and the likelihood of attribution when cited.',
    fix: {
      pass: 'Entity schema found — no action needed.',
      warn: 'Some entity signals found (og tags, author meta) but no JSON-LD. Upgrade to Organization or Person schema for stronger AI signals.',
      fail: 'No entity signals found. Add `<meta property="og:site_name">` and an Organization JSON-LD block to your site header.',
    },
  },
  c16_freshness: {
    why: 'AI models prefer recent, up-to-date content. dateModified and datePublished in your JSON-LD schema tell AI platforms when your content was last reviewed.',
    fix: {
      pass: 'Content freshness signals confirmed — no action needed.',
      warn: 'Date signals found but content appears old. Update your dateModified field whenever you revise content, even minor updates.',
      fail: 'No date signals found. Add `datePublished` and `dateModified` to your Article/WebPage JSON-LD, and use `<meta property="article:modified_time">` as a fallback.',
    },
  },
  c17_citation_density: {
    why: 'AI models weight content that cites authoritative external sources. Pages with tier-1 citations (NIH, Bloomberg, Reuters) are significantly more likely to be quoted verbatim by AI search engines than uncited claims.',
    fix: {
      pass: 'Strong citation density — no action needed.',
      warn: 'Moderate citations found. Add more links to tier-1 sources (government, academic, major publications) and ensure statistics are attributed with inline source links.',
      fail: 'Very few or no external citations found. Every factual claim should link to an authoritative source. Add at least 3–5 cited references per 1,000 words.',
    },
  },
  c18_factual_density: {
    why: 'AI systems prefer content with concrete, verifiable data — percentages, named entities, dates, and comparative figures. Vague, superlative-heavy content is rarely cited because it cannot be fact-checked.',
    fix: {
      pass: 'Good factual density — no action needed.',
      warn: 'Some facts found but content could be more data-rich. Add specific numbers, date references, and comparative statements (e.g. "up 23% YoY from $3.4B to $4.2B").',
      fail: 'Content is too vague or opinion-heavy. Replace generalisations with specific data points, named studies, and measurable outcomes.',
    },
  },
  c19_topical_authority: {
    why: 'AI models prefer sources that cover a topic deeply across multiple pages (pillar + cluster structure). A single page on a topic ranks lower for AI citation than a site with a pillar guide plus 5+ supporting articles.',
    fix: {
      pass: 'Strong topical cluster structure detected — no action needed.',
      warn: 'Partial topic coverage found. Identify your main topics and create a pillar page for each with at least 3–5 supporting cluster articles linked internally.',
      fail: 'No clear topical clusters detected. Build content silos: one in-depth pillar page per key topic, surrounded by shorter cluster articles that link back to it.',
    },
  },
  c20_chunkability: {
    why: 'AI models extract answers in chunks of 100–1,500 tokens. Content structured under clear headings with self-contained, answer-first paragraphs is extracted and cited at a much higher rate than wall-of-text prose.',
    fix: {
      pass: 'Content is well-chunked for AI extraction — no action needed.',
      warn: 'Some sections are hard to extract as standalone answers. Start each H2 section with a direct answer sentence, keep paragraphs under 200 words, and avoid referencing "above" or "below".',
      fail: 'Content has few or no H2 headings, making chunked extraction impossible. Break your content into clearly labelled H2 sections, each answering one question directly.',
    },
  },
}
