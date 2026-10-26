type Row = Record<string, unknown>
/** Declared page + literal keyword matching is a labelled heuristic, not a
 * search-engine query cluster or query-level conversion attribution. */
export function attributeOutcomeClusters(clusters: Row[], queries: Row[], analytics: Row[]) {
  return clusters.map(cluster => {
    const keywords = cluster.keywords as string[]
    const matches = queries.filter(row => row.page_url === cluster.target_url && keywords.some(keyword => String(row.query).normalize('NFC').toLowerCase().includes(keyword)))
    const clicks = matches.reduce((sum, row) => sum + Number(row.clicks), 0)
    const impressions = matches.reduce((sum, row) => sum + Number(row.impressions), 0)
    return { id: String(cluster.id), name: String(cluster.name), targetUrl: String(cluster.target_url), keywords,
      clicks, impressions, position: impressions ? matches.reduce((sum, row) => sum + Number(row.position) * Number(row.impressions), 0) / impressions : null,
      queryCount: matches.length, attribution: 'fimmick-page-keyword.v1', queryConversionAttribution: false,
      analytics: analytics.filter(row => row.page_url === cluster.target_url) }
  })
}
