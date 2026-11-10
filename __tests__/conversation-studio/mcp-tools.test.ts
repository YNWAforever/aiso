import { describe, expect, it } from 'vitest'
import {
  STUDIO_MCP_AUDIENCE,
  STUDIO_MCP_MAX_DRAFTS,
  STUDIO_MCP_TOOLS,
  studioMcpTool,
  type StudioMcpToolName,
} from '@/lib/conversation-studio/mcp/registry'

const names: StudioMcpToolName[] = [
  'brand_evidence',
  'scan_checks',
  'content_opportunities',
  'brand_sources',
  'work_item_drafts',
  'search_console_status',
]

describe('Studio MCP tool registry', () => {
  it('publishes exactly the approved read-only tools, once each', () => {
    expect(STUDIO_MCP_TOOLS.map(tool => tool.name)).toEqual(names)
    expect(new Set(STUDIO_MCP_TOOLS.map(tool => tool.name)).size).toBe(names.length)
  })

  it('is internal-only, read-only and discoverable', () => {
    expect(STUDIO_MCP_AUDIENCE).toBe('internal')
    for (const tool of STUDIO_MCP_TOOLS) {
      expect(tool.audience).toBe('internal')
      expect(tool.readOnly).toBe(true)
      expect(tool.title.length).toBeGreaterThan(0)
      expect(tool.description.length).toBeGreaterThan(20)
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.inputSchema.additionalProperties).toBe(false)
    }
  })

  it('never lets a caller choose whose records to read', () => {
    for (const tool of STUDIO_MCP_TOOLS) {
      const published = JSON.stringify(tool.inputSchema)
      for (const forbidden of ['accountId', 'account_id', 'clientId', 'client_id', 'profileId', 'profile_id']) {
        expect(published, `${tool.name} must not accept ${forbidden}`).not.toContain(forbidden)
      }
    }
  })

  it('accepts no arguments, or an explicit empty object, on the no-argument tools', () => {
    for (const tool of STUDIO_MCP_TOOLS.filter(item => Object.keys(item.inputSchema.properties).length === 0)) {
      expect(tool.parse(undefined)).toEqual({})
      expect(tool.parse({})).toEqual({})
      expect(tool.parse({ accountId: 'elsewhere' })).toBeNull()
      expect(tool.parse({ limit: 1 })).toBeNull()
      expect(tool.parse([])).toBeNull()
      expect(tool.parse(null)).toBeNull()
    }
  })

  it('bounds the opportunity language and rejects unknown options', () => {
    const tool = studioMcpTool('content_opportunities')!
    expect(tool.parse(undefined)).toEqual({ language: 'en' })
    expect(tool.parse({})).toEqual({ language: 'en' })
    expect(tool.parse({ language: 'zh-HK' })).toEqual({ language: 'zh-HK' })
    expect(tool.parse({ language: 'fr' })).toBeNull()
    expect(tool.parse({ language: 3 })).toBeNull()
    expect(tool.parse({ language: 'en', clientId: '00000000-0000-4000-8000-000000000000' })).toBeNull()
  })

  it('bounds the draft page size and rejects extra keys', () => {
    const tool = studioMcpTool('work_item_drafts')!
    expect(tool.parse(undefined)).toEqual({ limit: 5 })
    expect(tool.parse({})).toEqual({ limit: 5 })
    expect(tool.parse({ limit: 1 })).toEqual({ limit: 1 })
    expect(tool.parse({ limit: STUDIO_MCP_MAX_DRAFTS })).toEqual({ limit: STUDIO_MCP_MAX_DRAFTS })
    for (const value of [0, STUDIO_MCP_MAX_DRAFTS + 1, 2.5, '3', true, null]) expect(tool.parse({ limit: value })).toBeNull()
    expect(tool.parse({ limit: 3, accountId: 'elsewhere' })).toBeNull()
  })

  it('returns null for an unknown tool and never invents a permissive default', () => {
    expect(studioMcpTool('anything')).toBeNull()
    expect(studioMcpTool('')).toBeNull()
    expect(studioMcpTool('__proto__')).toBeNull()
    expect(studioMcpTool('constructor')).toBeNull()
  })
})
