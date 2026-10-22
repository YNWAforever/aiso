/**
 * Check method versions, split from lib/scan-evidence.ts so client code that
 * only needs a version string (factual-density-evidence, via the result page)
 * does not pull in node:crypto, which bundles a ~100 KB browser polyfill.
 * lib/scan-evidence.ts re-exports everything here; import from either.
 */
/** Check versions of scanner method 2026-09-05.v1. Frozen: stored envelopes rebuild against it. */
export const CHECK_VERSIONS_2026_09_05 = {
  c1_robots: '2026-09-05.v1', c2_llms_txt: '2026-08-31.v1', c3_bot_access: '2026-08-31.v1',
  c4_structured_data: '2026-08-31.v1', c5_extractability: '2026-08-31.v1', c6_llms_full_txt: '2026-08-31.v1',
  c7_mcp_card: '2026-08-31.v1', c8_sitemap: '2026-08-31.v1', c9_meta_desc: '2026-08-31.v1',
  c10_headings: '2026-08-31.v1', c11_faq: '2026-08-31.v1', c12_canonical: '2026-08-31.v1',
  c13_render: '2026-08-31.v1', c14_internal_links: '2026-08-31.v1', c15_entity: '2026-08-31.v1',
  c16_freshness: '2026-08-31.v1', c17_citation_density: '2026-08-31.v1', c18_factual_density: '2026-08-31.v1',
  c19_topical_authority: '2026-08-31.v1', c20_chunkability: '2026-08-31.v1',
} as const
/** 2026-10-03.v1 (remediation branch): c1, c3 and c6 revised. */
export const CHECK_VERSIONS_2026_10_03 = { ...CHECK_VERSIONS_2026_09_05,
  c1_robots: '2026-10-03.v1', c3_bot_access: '2026-10-03.v1', c6_llms_full_txt: '2026-10-03.v1' } as const
/** 2026-10-07.v1 (remediation branch, UAT only): c18 unavailable uniqueness. */
export const CHECK_VERSIONS_2026_10_07 = { ...CHECK_VERSIONS_2026_10_03, c18_factual_density: '2026-10-07.v1' } as const
/** 2026-10-09.v1 (main, PR #70, served in production 2026-10-10): c17-c20 revised. */
export const CHECK_VERSIONS_2026_10_09 = { ...CHECK_VERSIONS_2026_09_05,
  c17_citation_density: '2026-10-09.v1', c18_factual_density: '2026-10-09.v1',
  c19_topical_authority: '2026-10-09.v1', c20_chunkability: '2026-10-09.v1' } as const
/**
 * 2026-10-10.v1: the two lines joined. c1/c3/c6 as revised on 2026-10-03;
 * c17/c18/c20 read visible text only; c18/c19 report a provider failure as
 * unavailable instead of scoring it; c19 does not ask the model to cluster
 * URLs that form no groups.
 */
export const CHECK_VERSIONS = { ...CHECK_VERSIONS_2026_10_03,
  c17_citation_density: '2026-10-10.v1', c18_factual_density: '2026-10-10.v1',
  c19_topical_authority: '2026-10-10.v1', c20_chunkability: '2026-10-10.v1' } as const
export type EvidenceCheckKey = keyof typeof CHECK_VERSIONS
