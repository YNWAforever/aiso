import { describe, expect, it } from 'vitest'
import { isStudioSkillId, parseStudioSkill, skillForTask, skillForThread, STUDIO_CARD_SKILLS, STUDIO_SKILL_IDS, STUDIO_SKILLS } from '@/lib/conversation-studio/skills'
import { STUDIO_HOME_TEMPLATES } from '@/lib/conversation-studio/home'
import { STUDIO_MCP_TOOLS } from '@/lib/conversation-studio/mcp/registry'

describe('Studio skill registry', () => {
  it('declares each skill id once and maps every v1 card to a home task', () => {
    expect(new Set(STUDIO_SKILL_IDS).size).toBe(STUDIO_SKILL_IDS.length)
    const tasks = STUDIO_SKILLS.filter(skill => skill.task).map(skill => skill.task)
    expect(new Set(tasks).size).toBe(tasks.length)
    for (const task of STUDIO_HOME_TEMPLATES) expect(tasks).toContain(task)
    expect(STUDIO_CARD_SKILLS.map(skill => skill.task)).toEqual(['pulse', 'opportunity', 'improve', 'competitors', 'brief', 'report'])
  })

  it('declares only real read-only MCP tools', () => {
    const toolNames = new Set(STUDIO_MCP_TOOLS.map(tool => tool.name))
    for (const skill of STUDIO_SKILLS) {
      expect(skill.tools.length).toBeGreaterThan(0)
      for (const tool of skill.tools) expect(toolNames.has(tool)).toBe(true)
    }
  })

  it('keeps action skills out of the one-tap cards until slice 4', () => {
    for (const skill of STUDIO_SKILLS.filter(item => item.runs === 'action')) expect(skill.task).toBeNull()
    expect(STUDIO_CARD_SKILLS.some(skill => skill.runs !== 'context-only')).toBe(false)
  })

  it('derives a thread skill from the persisted column, else from the first task', () => {
    expect(skillForThread({ skill: 'top_opportunity', firstTask: 'report' })).toBe('top_opportunity')
    expect(skillForThread({ skill: null, firstTask: 'pulse' })).toBe('visibility_now')
    expect(skillForThread({ skill: 'not_a_skill', firstTask: 'report' })).toBe('monthly_report')
    expect(skillForThread({})).toBeNull()
  })

  it('validates persisted values instead of trusting the caller', () => {
    expect(isStudioSkillId('visibility_now')).toBe(true)
    expect(isStudioSkillId('VISIBILITY_NOW')).toBe(false)
    expect(parseStudioSkill('nope')).toBeNull()
    expect(parseStudioSkill(null)).toBeNull()
    expect(skillForTask('competitors')).toBe('compare_competitors')
    expect(skillForTask(null)).toBeNull()
  })
})
