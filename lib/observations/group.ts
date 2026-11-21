import type { Observation } from './types'

/**
 * The answer log returns one row per platform, so a week with ten questions
 * renders forty to fifty nearly identical cards. This projection groups the
 * rows under their question so the page can show one card per question and a
 * compact platform list underneath.
 *
 * Keep each historical wording with its saved answers, even if the prompt was
 * later edited. Historical rows without a prompt ID still group by wording.
 */
export type ObservationGroup = {
  key: string
  promptId: string | null
  question: string
  items: Observation[]
  platforms: string[]
  mentioned: number
  notMentioned: number
  unknownMention: number
  complete: number
  incomplete: number
  answerless: number
}

export function groupObservations(items: readonly Observation[]): ObservationGroup[] {
  const groups = new Map<string, ObservationGroup>()
  for (const item of items) {
    const key = item.promptId
      ? JSON.stringify([item.promptId, item.question])
      : `question:${item.question.trim().replace(/\s+/g, ' ').toLocaleLowerCase()}`
    const group = groups.get(key) ?? {
      key,
      promptId: item.promptId,
      question: item.question,
      items: [],
      platforms: [],
      mentioned: 0,
      notMentioned: 0,
      unknownMention: 0,
      complete: 0,
      incomplete: 0,
      answerless: 0,
    }
    group.items.push(item)
    if (!group.platforms.includes(item.platform)) group.platforms.push(item.platform)
    if (item.brandMentioned === true) group.mentioned += 1
    else if (item.brandMentioned === false) group.notMentioned += 1
    else group.unknownMention += 1
    if (item.result === 'success') group.complete += 1
    else group.incomplete += 1
    if (!item.hasAnswer) group.answerless += 1
    groups.set(key, group)
  }
  return [...groups.values()]
}
