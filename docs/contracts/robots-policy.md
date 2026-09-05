# Robots policy detection — C6

Scanner/check c1 version: `2026-09-05.v1`. This is a detection-version change; headline weights, grades and pillar methodology are unchanged.

The check evaluates declared access to `/`, matching the scanner's existing origin-page scope. A prohibition on `/private` alone is not a prohibition on `/`. Group directives and agent tokens are case-insensitive; paths are case-sensitive. Matching exact agent groups are combined; wildcard groups apply only without an exact group. Consecutive user-agent lines share rules. Empty rules impose no restriction. Rules before a group are ignored. The longest matching rule wins (including wildcard/end-marker syntax bytes), and Allow wins equivalent ties. Leading wildcard patterns are accepted, including the RFC example `*.gif$`. `*` and terminal `$` are supported, with percent-encoded unreserved octet normalization.

The benchmark retains its existing messages and policy: any blocked automatic catalogue entry yields robots_ai_blocked; at least one explicit unblocked automatic entry yields robots_ai_allowed; otherwise robots_no_ai_rules. Generic Disallow now correctly applies to unconfigured agents. This benchmark is not a direct measurement of search inclusion or a recommendation to allow training.

The catalogue distinguishes search crawlers, training crawlers, user-requested fetchers and product-control tokens. User-requested fetchers are documented but excluded from automatic-crawler scoring. Google-Extended is a product-control token, not a separate HTTP crawler. Legacy anthropic-ai is retained only for benchmark compatibility, not presented as a currently documented token. Fetch failure and HTTP server/auth errors carry failed collection; HTTP 404/410 retains the existing failed benchmark while describing a successfully observed absence.

## Primary references checked 2026-09-05

- [Google robots specification](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec): concrete longest-rule examples including `/*.htm` and terminal `$`.
- [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html): group merging, wildcard fallback, path matching, special characters and octet normalization.
- [OpenAI crawlers](https://developers.openai.com/api/docs/bots): OAI-SearchBot for search, GPTBot for training, ChatGPT-User for user actions where robots policy may not apply.
- [Anthropic crawler guidance](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler): distinct ClaudeBot, Claude-SearchBot and Claude-User roles.
- [Perplexity crawlers](https://docs.perplexity.ai/docs/resources/perplexity-crawlers): PerplexityBot search role; user-requested fetcher is not training or automatic crawling.
- [Google common crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers): Google-Extended controls specified Gemini training/grounding use and does not control Google Search inclusion.

Fixtures verify declared rules, not real provider visits, IP identity, actual compliance, WAF behavior or search visibility. Fetch transport remains injected and SSRF-protected. No live crawler request or provider configuration was performed.
