# Fimmick AISO — GEO, AEO and SEO Product Roadmap

**Status:** Product and engineering direction  
**Updated:** 2026-08-26  
**North star:** Turn a URL scan into a measurable system that helps a brand become discoverable, answerable and citable across search and AI assistants.

## 1. Product direction

Fimmick should be positioned as one AI search optimisation platform with three complementary diagnostic pillars:

1. **SEO Foundation** — can search engines discover, crawl, index and understand the site?
2. **AEO Answer Readiness** — can machines extract a direct, complete and useful answer from the content?
3. **GEO Citation Authority** — does the content contain enough evidence, entity clarity, factual depth and topical authority to earn citations in generated answers?

**AI Pulse** is the outcome layer across all three pillars. It should measure whether changes improve real visibility, citations, share of voice, traffic and conversion rather than merely improving an internal score.

The existing 100-point AISO score remains the stable headline benchmark. The three pillar scores are overlapping diagnostic views and must never be added together.

## 2. Current strengths

The codebase already contains much more than a lightweight scanner:

- A deterministic 20-check scoring engine with traceable pass, warning and fail results.
- Core, extended and GEO checks, including citation density, factual density, topical authority and chunkability.
- A bilingual English and Traditional Chinese experience.
- Multi-tenant workspaces, authentication, subscriptions, entitlements and scan quotas.
- Fix Pack outputs, recommendation and progress agents, competitor workflows, Local Trust and AI Pulse features.
- Strong SSRF controls, account-scoped data access, CI, unit tests and end-to-end tests.
- A public scan-to-sign-up funnel and authenticated result workspace.

This is a credible SaaS foundation. The biggest opportunity is no longer feature count; it is measurement accuracy, product clarity and a closed improvement loop.

## 3. Highest-priority audit findings

### P0 — Correct the crawler and robots model

The present implementation mixes **search/retrieval crawlers** with **training crawlers**:

- `GPTBot`, `ClaudeBot` and `Google-Extended` primarily control model-training or model-improvement use.
- `OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot` and `Googlebot` are more directly relevant to search discovery and generated-answer visibility.
- User-triggered fetchers such as `ChatGPT-User`, `Claude-User` and `Perplexity-User` have different behaviour and should be reported separately.

Required changes:

- Maintain a centrally versioned crawler catalogue with provider, role, official user-agent token, official IP-range endpoint and last-verified date.
- Score search visibility from search/retrieval bots, not training permission.
- Report training opt-outs as governance information without penalising search visibility.
- Treat an absent `robots.txt` file as default allow, not an automatic failure.
- Parse wildcard groups and rule precedence rather than checking only for a literal `Disallow: /` in explicitly named groups.
- Do not infer legitimate bot access only by spoofing a user-agent from an unverified IP. Combine robots policy, official IP verification guidance and first-party server-log evidence where available.

### P0 — Recalibrate experimental signals

`llms.txt`, `llms-full.txt` and MCP discovery are useful agent-facing conventions, but they should not outweigh proven crawlability, indexability, structured data, content quality and site architecture without outcome evidence.

Required changes:

- Label every check as **standard**, **provider-documented**, **emerging convention** or **Fimmick heuristic**.
- Publish a scoring-methodology page showing weights, evidence, version history and known limitations.
- Add `methodology_version` to every scan.
- Recalibrate weights using observed relationships with citations, search impressions and successful retrievals.
- Preserve historical score snapshots whenever a methodology changes.

### P0 — Make every score auditable

A client should be able to answer: “Why did this check pass, what was inspected, and how do we prove the fix worked?”

Each check should persist:

- evaluated URL;
- fetched-at timestamp;
- response status, selected headers and final redirect URL;
- evidence excerpt or parsed signal;
- check version and scanner version;
- confidence and limitation flags;
- recommended fix;
- validation procedure.

Sensitive or excessive page content should not be stored by default. Store compact evidence, hashes and opt-in snapshots with retention controls.

### P1 — Move from a homepage scan to a representative site audit

A single page cannot represent a full brand site. Build a bounded site crawler that samples by page type:

- homepage;
- product or service pages;
- category or collection pages;
- articles or resources;
- about, contact and location pages;
- policy and support pages;
- important orphan or low-linked pages.

The crawler should use sitemaps and internal links, respect crawl limits, deduplicate canonical URLs and classify templates. Report both site-wide issues and page-specific exceptions.

### P1 — Connect diagnostics to measurable outcomes

Add first-party integrations so AISO becomes an optimisation system rather than a standalone score:

- Google Search Console for queries, pages, clicks, impressions, position and search appearance.
- Bing Webmaster Tools and IndexNow for discovery and update signals.
- Analytics and conversion events for business impact.
- Optional server/CDN logs for verified crawler activity.
- AI Pulse observations for prompt, answer, citation URL, citation position, sentiment, locale and model/version metadata.

The product should distinguish three evidence classes:

1. **Technical readiness** — what the site allows and exposes.
2. **Observed retrieval** — what verified crawlers and platforms actually accessed.
3. **Observed outcomes** — where the brand appeared, was cited, earned traffic or converted.

### P1 — Turn recommendations into managed work

Replace generic advice with an issue lifecycle:

`Detected → Prioritised → Assigned → In progress → Deployed → Re-validated → Outcome observed`

Every recommendation should contain:

- affected URLs and page templates;
- exact evidence;
- expected pillar impact;
- business impact hypothesis;
- effort and confidence;
- implementation instructions or generated patch;
- owner and due date;
- automatic re-test;
- before/after result.

### P1 — Build a query and intent model for AI Pulse

Prompt monitoring should be organised, not a flat prompt list. Each monitored query needs:

- market and language;
- persona or buyer role;
- funnel stage;
- intent: informational, comparison, commercial, transactional, local or support;
- branded versus unbranded status;
- topic cluster and target page;
- priority and expected answer attributes;
- competitor set.

AI Pulse should report:

- answer presence;
- citation presence and citation share;
- first citation position;
- recommendation or exclusion;
- message accuracy;
- sentiment and risk;
- competitor share of voice;
- answer volatility;
- source domains repeatedly trusted by each platform.

## 4. Target product architecture

### Layer 1 — Acquisition

- Public one-URL scan.
- Authenticated site crawl.
- Search Console, Bing, analytics and log integrations.
- AI-platform monitoring jobs.

### Layer 2 — Evidence store

- Normalised URL and page-template inventory.
- Compact technical and content evidence.
- Crawler-policy observations.
- Prompt runs, answers and citations.
- Versioned methodology and scanner metadata.

### Layer 3 — Intelligence

- Stable 100-point AISO benchmark.
- SEO, AEO and GEO diagnostic pillars.
- Site-wide and page-level issue aggregation.
- Competitor and citation-source gap analysis.
- Confidence-aware impact and effort prioritisation.

### Layer 4 — Activation

- Fix Pack and CMS-specific implementation recipes.
- Technical patches, schema generation and content briefs.
- Editorial workflow, assignments and approvals.
- Deployment hooks and re-validation.

### Layer 5 — Measurement

- Score and issue trend lines.
- Search performance and conversion impact.
- AI citation and share-of-voice movement.
- Regression and opportunity alerts.
- Client-ready and white-label reporting.

## 5. Recommended data-model additions

Suggested entities and fields:

### `scan_runs`

- `scanner_version`
- `methodology_version`
- `crawl_scope`
- `started_at`, `completed_at`
- `page_count_requested`, `page_count_completed`
- `partial_reason`

### `scan_pages`

- `scan_id`
- `url`, `canonical_url`
- `page_type`, `template_fingerprint`
- `http_status`, `render_mode`
- `content_hash`
- `evidence_retention_class`

### `check_evidence`

- `scan_page_id`
- `check_key`, `check_version`
- `status`, `confidence`
- `evidence_json`
- `recommendation_id`

### `monitored_queries`

- `locale`, `market`, `persona`
- `intent`, `funnel_stage`
- `topic_cluster`, `target_url`
- `priority`, `active`

### `ai_observations`

- `query_id`, `platform`, `model_label`
- `observed_at`
- `answer_hash`, optional encrypted answer snapshot
- `brand_present`, `recommended`
- `citation_urls`, `citation_positions`
- `competitors_present`
- `sentiment`, `accuracy_flags`

### `recommendation_work_items`

- `issue_key`, `affected_urls`
- `priority`, `effort`, `confidence`
- `owner`, `status`
- `deployed_at`, `validated_at`
- `before_snapshot`, `after_snapshot`

## 6. Delivery sequence

### Phase 0 — Trust and clarity

- Ship SEO, AEO and GEO diagnostic pillar scores without changing the overall score.
- Correct crawler roles and robots semantics.
- Add methodology and scanner versioning.
- Fix product, pricing and documentation claims that disagree with runtime release state.
- Add evidence and limitation copy to every high-impact check.

### Phase 1 — Site intelligence

- Add bounded multi-page crawling and page-type classification.
- Add site-wide issue aggregation and affected-URL lists.
- Add evidence snapshots and automatic re-validation.
- Introduce an implementation backlog inside each client workspace.

### Phase 2 — Outcome integrations

- Connect Search Console, Bing/IndexNow, analytics and optional crawler logs.
- Attribute improvements to queries, pages, citations, traffic and conversions.
- Add regression alerts tied to deployments and score changes.

### Phase 3 — Closed-loop AI visibility

- Expand AI Pulse into a query-intent and competitor measurement system.
- Build citation-source gap maps and source-authority recommendations.
- Generate content briefs, schema and technical patches from measured gaps.
- Re-run monitored prompts and site checks after deployment.

### Phase 4 — Enterprise operating system

- White-label portals and scheduled executive reports.
- Public API and webhooks.
- Role-based workflows, approvals and audit logs.
- Multi-market benchmarks and custom platform adapters.

## 7. Product packaging direction

Do not sell only “more scans.” Package increasing levels of evidence and operating capability:

- **Free:** one-URL benchmark, three pillar scores and one highest-impact issue.
- **Basic:** one brand, representative site scan, prioritised fixes and limited history.
- **Pro:** ongoing monitoring, Search Console integration, managed work items, AI Pulse and client reports.
- **Enterprise:** multi-brand and multi-market monitoring, full competitor intelligence, custom query sets, API, white-label reporting and governance controls.

Pricing claims should be generated from the same plan catalogue and release-state source used by runtime entitlements. This prevents the marketing site, checkout, dashboard and documentation from drifting apart.

## 8. Success metrics

### Product trust

- Percentage of checks with inspectable evidence.
- False-positive and false-negative rate from reviewed scans.
- Percentage of scan runs with complete methodology/version metadata.
- Reproducibility of a score from stored evidence.

### Activation

- Public scan completion rate.
- Result-to-account conversion.
- Percentage of workspaces that deploy at least one recommendation.
- Median time from issue detection to validated fix.

### Outcomes

- Search impressions and clicks for target query clusters.
- Valid indexed pages and structured-data health.
- AI answer presence and citation share.
- Citation position and competitor share-of-voice movement.
- Qualified traffic, leads and revenue associated with improved pages.

### Retention

- Weekly active monitored brands.
- Percentage of clients with an active query set and integration.
- Alert-to-action rate.
- Report views and recommendation completion rate.

## 9. Guardrails

- Never promise that a technical change guarantees ranking, AI inclusion or citation.
- Separate provider-documented facts from Fimmick heuristics.
- Do not penalise a customer for opting out of model training when search access remains enabled.
- Keep prompt monitoring reproducible: record locale, model label, timestamp and sampling configuration.
- Treat AI answers as volatile observations, not ground truth.
- Make generated recommendations reviewable before deployment.
- Keep scan scope bounded, respectful and SSRF-safe.

## 10. Primary reference points

- Google Search Central — AI features and your website: <https://developers.google.com/search/docs/appearance/ai-features>
- Google Search Central — structured data guidelines: <https://developers.google.com/search/docs/appearance/structured-data/sd-policies>
- Google Search Console API: <https://developers.google.com/webmaster-tools/>
- OpenAI crawler documentation: <https://developers.openai.com/api/docs/bots>
- Anthropic crawler documentation: <https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler>
- Perplexity crawler documentation: <https://docs.perplexity.ai/docs/resources/perplexity-crawlers>
- IndexNow: <https://www.bing.com/indexnow>
- `llms.txt` proposal: <https://github.com/AnswerDotAI/llms-txt>
