import type { CheckResult, IndustryCode, RegionCode, ChunkabilityResult } from '@/lib/types'

interface Context { industry: IndustryCode; region: RegionCode }

export async function checkChunkability(
  html: string,
  _context: Context
): Promise<CheckResult & { geoDetails?: ChunkabilityResult }> {
  const headingPattern = /<h([2-4])[^>]*>([\s\S]*?)<\/h\1>([\s\S]*?)(?=<h[2-4]|$)/gi
  const chunks: ChunkabilityResult['chunkAnalysis'] = []
  let m: RegExpExecArray | null

  while ((m = headingPattern.exec(html)) !== null) {
    const heading = m[2].replace(/<[^>]+>/g, '').trim()
    const body = m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const words = body.split(/\s+/).filter(Boolean)
    const wordCount = words.length
    const tokenEstimate = Math.ceil(wordCount * 1.3)

    const firstSentence = body.split(/[.!?]/)[0] ?? ''
    const isAnswerFirst = firstSentence.length > 20 && !firstSentence.startsWith('In this')
    const isSelfContained = !/^(This|It|They|These|Those|Above|Below|As mentioned)\s/i.test(body)
    const hasDefinition = /\bis\b|\bare\b|\brefers to\b|\bmeans\b/i.test(firstSentence)
    const hasList = /<[uo]l|<li/i.test(m[3])

    const extractabilityScore = Math.min(100,
      (isAnswerFirst   ? 30 : 0) +
      (isSelfContained ? 25 : 0) +
      (hasDefinition   ? 20 : 0) +
      (hasList         ? 15 : 0) +
      (tokenEstimate >= 100 && tokenEstimate <= 1500 ? 10 : 0)
    )

    chunks.push({ heading, wordCount, tokenEstimate, isAnswerFirst, isSelfContained, hasDefinition, hasList, extractabilityScore })
  }

  if (!chunks.length) {
    return {
      status: 'fail', message: 'chunkability_no_headings',
      geoDetails: { avgChunkLength: 0, optimalChunkRatio: 0, hasFaqStyle: false, totalChunks: 0, chunkAnalysis: [] },
    }
  }

  const avgChunkLength = chunks.reduce((s, c) => s + c.wordCount, 0) / chunks.length
  const optimalChunks = chunks.filter(c => c.tokenEstimate >= 100 && c.tokenEstimate <= 1500)
  const optimalChunkRatio = optimalChunks.length / chunks.length
  const hasFaqStyle = chunks.some(c => /^(what|how|why|when|where|which|can|does|is)\s/i.test(c.heading))
  const avgScore = chunks.reduce((s, c) => s + c.extractabilityScore, 0) / chunks.length
  const status = avgScore >= 60 ? 'pass' : avgScore >= 30 ? 'warn' : 'fail'

  return {
    status, message: `chunkability_${status}`,
    details: `${chunks.length} chunks, avg score ${Math.round(avgScore)}/100`,
    geoDetails: { avgChunkLength, optimalChunkRatio, hasFaqStyle, totalChunks: chunks.length, chunkAnalysis: chunks },
  }
}
