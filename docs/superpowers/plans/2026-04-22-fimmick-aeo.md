# Fimmick AEO Lite + AI Pulse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a bilingual (EN/ZH-HK) AEO check tool + AI Pulse brand mention tracker as a single Next.js 15 app deployed on Vercel, backed by Supabase and OpenRouter.

**Architecture:** Phase 1 — public URL scanner (5 checks + AI Fix Pack). Phase 2 — no-auth `/pulse/[clientId]` dashboard fed weekly by a self-hosted n8n workflow querying 5 AI platforms. All data in one Supabase project (`ggudkqnxglvydplqmcbh`), no Vercel KV.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS, next-intl, @supabase/supabase-js, OpenRouter API, Recharts, Vitest

---

## File Map

```
app/
  [lang]/
    layout.tsx                        # i18n provider + nav
    page.tsx                          # Home: URL input
    result/[id]/page.tsx              # Scan results + Fix Pack
    pulse/[clientId]/page.tsx         # Phase 2 dashboard
  api/
    scan/route.ts                     # POST: 5 checks → Supabase
    fix/route.ts                      # POST: OpenRouter Fix Pack
    pulse/
      onboard/route.ts                # POST: create client + 50 prompts
      [clientId]/summary/route.ts     # GET: weekly summary for charts
      [clientId]/missed/route.ts      # GET: unmentioned prompts
lib/
  types.ts                            # All TypeScript interfaces
  supabase.ts                         # Supabase client singleton
  openrouter.ts                       # callOpenRouter() + callMultiPlatform()
  checks/
    robots.ts                         # C1: robots.txt AI policy
    llmsTxt.ts                        # C2: llms.txt present
    botAccess.ts                      # C3: 3 bot UAs can fetch homepage
    structuredData.ts                 # C4: JSON-LD schema found
    extractability.ts                 # C5: meaningful text in HTML
components/
  ScoreRing.tsx                       # Circular score + colour band
  CheckItem.tsx                       # Single check row: icon + message
  FixPackBlock.tsx                    # Code block + copy button
  FixPackClient.tsx                   # Client component: trigger Fix Pack generation
  pulse/
    SovChart.tsx                      # Recharts LineChart (8-week SoV)
    PlatformBar.tsx                   # Recharts BarChart (platform breakdown)
    MissedTable.tsx                   # Table: queries with no brand mention
messages/
  en.json                             # English UI strings
  zh-HK.json                         # Traditional Chinese UI strings
middleware.ts                         # next-intl locale detection + redirect
supabase/migrations/
  001_phase1.sql                      # scans, fix_packs
  002_phase2.sql                      # clients, prompt_bank, pulse_metrics, pulse_weekly_summary
n8n/
  ai-pulse-weekly.json                # Importable n8n workflow
__tests__/
  checks/robots.test.ts
  checks/llmsTxt.test.ts
  checks/botAccess.test.ts
  checks/structuredData.test.ts
  checks/extractability.test.ts
  api/scan.test.ts
  api/fix.test.ts
```

---

## Task 1: Project Initialization

**Files:**
- Create: (project root via create-next-app)
- Create: `vitest.config.ts`
- Create: `.env.local`

- [ ] **Step 1: Scaffold Next.js 15 project**

Run from `/Users/willylai/Documents/Claude/Projects/AEO`:
```bash
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --yes
```

- [ ] **Step 2: Install dependencies**
```bash
npm install next-intl @supabase/supabase-js recharts
npm install -D vitest @vitest/coverage-v8
```

- [ ] **Step 3: Create `vitest.config.ts`**
```typescript
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
})
```

- [ ] **Step 4: Add test scripts to `package.json`**

In the `"scripts"` section, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Create `.env.local`**
```bash
OPENROUTER_API_KEY=<your key>
NEXT_PUBLIC_SUPABASE_URL=https://ggudkqnxglvydplqmcbh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from Supabase → Project Settings → API → anon key>
SUPABASE_SERVICE_ROLE_KEY=<from Supabase → Project Settings → API → service_role key>
```

- [ ] **Step 6: Update `.gitignore`**

Append to `.gitignore`:
```
.env.local
.superpowers/
```

- [ ] **Step 7: Verify dev server starts**
```bash
npm run dev
```
Expected: server at http://localhost:3000, default Next.js page loads.

- [ ] **Step 8: Commit**
```bash
git add -A
git commit -m "chore: init Next.js 15 + Tailwind + Vitest + deps"
```

---

## Task 2: Shared Types and Clients

**Files:**
- Create: `lib/types.ts`
- Create: `lib/supabase.ts`
- Create: `lib/openrouter.ts`

- [ ] **Step 1: Create `lib/types.ts`**
```typescript
export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface CheckResult {
  status: CheckStatus
  message: string
  details?: string
}

export interface ScanResults {
  c1_robots: CheckResult
  c2_llms_txt: CheckResult
  c3_bot_access: CheckResult
  c4_structured_data: CheckResult
  c5_extractability: CheckResult
}

export interface Scan {
  id: string
  url: string
  domain: string
  score: number
  results: ScanResults
  created_at: string
}

export interface FixPack {
  id: string
  scan_id: string
  llms_txt: string
  robots_patch: string
  faq_schema: string
  created_at: string
}

export interface Client {
  id: string
  brand_name: string
  industry: string | null
  competitors: string[]
  status: string
  created_at: string
}

export interface PulseWeeklySummary {
  id: string
  client_id: string
  scan_week: string
  platform: string | null
  total_queries: number
  brand_mentions: number
  sov_score: number
  avg_sentiment_score: number
  top_competitors: Record<string, number>
  created_at: string
}

export interface PulseMetric {
  id: string
  client_id: string
  prompt_id: string
  platform: string
  question: string
  raw_answer: string | null
  brand_mentioned: boolean
  sentiment: 'positive' | 'neutral' | 'negative' | 'not_mentioned'
  mention_position: number | null
  competitors_mentioned: string[]
  scan_week: string
  created_at: string
}
```

- [ ] **Step 2: Create `lib/supabase.ts`**
```typescript
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(url, key)
```

- [ ] **Step 3: Create `lib/openrouter.ts`**
```typescript
const BASE = 'https://openrouter.ai/api/v1/chat/completions'

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface CallOptions {
  model: string
  messages: Message[]
  maxTokens?: number
}

export async function callOpenRouter({ model, messages, maxTokens = 2000 }: CallOptions): Promise<string> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://aeo.fimmick.com',
      'X-Title': 'Fimmick AEO',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
  })

  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.choices[0].message.content as string
}

const PLATFORMS = [
  { platform: 'perplexity-sonar',     model: 'perplexity/sonar' },
  { platform: 'perplexity-sonar-pro', model: 'perplexity/sonar-pro' },
  { platform: 'gpt-4o',               model: 'openai/gpt-4o' },
  { platform: 'claude-haiku',         model: 'anthropic/claude-haiku-4-5' },
  { platform: 'gemini-flash',         model: 'google/gemini-flash-2.0' },
]

export async function callMultiPlatform(
  messages: Message[],
  maxTokens = 1000,
): Promise<Array<{ platform: string; answer: string }>> {
  const results = await Promise.allSettled(
    PLATFORMS.map(async ({ platform, model }) => ({
      platform,
      answer: await callOpenRouter({ model, messages, maxTokens }),
    })),
  )
  return results
    .filter((r): r is PromiseFulfilledResult<{ platform: string; answer: string }> => r.status === 'fulfilled')
    .map(r => r.value)
}
```

- [ ] **Step 4: Verify TypeScript compiles**
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**
```bash
git add lib/
git commit -m "feat: add shared types, supabase client, openrouter wrapper"
```

---

## Task 3: Supabase Migrations — Phase 1

**Files:**
- Create: `supabase/migrations/001_phase1.sql`

- [ ] **Step 1: Create migration file**
```sql
-- supabase/migrations/001_phase1.sql
create table if not exists scans (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  domain text not null,
  score numeric(5,2),
  results jsonb not null,
  created_at timestamptz default now()
);

create table if not exists fix_packs (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid references scans(id) on delete cascade,
  llms_txt text,
  robots_patch text,
  faq_schema text,
  created_at timestamptz default now()
);
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use the `mcp__ebffcbd7__apply_migration` tool with:
- `project_id`: `ggudkqnxglvydplqmcbh`
- `name`: `001_phase1`
- SQL content from the file above

- [ ] **Step 3: Verify tables exist**

Use `mcp__ebffcbd7__list_tables` with `project_id: ggudkqnxglvydplqmcbh`.
Expected: `scans` and `fix_packs` appear in the list.

- [ ] **Step 4: Commit**
```bash
git add supabase/
git commit -m "feat: add Phase 1 Supabase schema (scans, fix_packs)"
```

---

## Task 4: i18n Setup

**Files:**
- Create: `messages/en.json`
- Create: `messages/zh-HK.json`
- Create: `middleware.ts`
- Modify: `next.config.ts`

- [ ] **Step 1: Create `messages/en.json`**
```json
{
  "nav": { "title": "Fimmick AEO", "en": "EN", "zh": "中文" },
  "home": {
    "badge": "FREE AI READINESS CHECK",
    "headline": "Is Your Website\nVisible to AI Search?",
    "subheadline": "Check in 30 seconds. Free Fix Pack included.",
    "placeholder": "https://yourwebsite.com",
    "cta": "Scan →",
    "trust": "Checks robots.txt · llms.txt · Bot Access · Schema · Content"
  },
  "result": {
    "score_label": "AI Readiness Score",
    "score_good": "Excellent",
    "score_ok": "Needs Improvement",
    "score_bad": "Critical Issues",
    "checks_title": "5 CHECKS",
    "fix_cta": "Generate Fix Pack",
    "fix_subtitle": "llms.txt · robots patch · FAQ JSON-LD",
    "copy": "Copy",
    "copied": "Copied!"
  },
  "checks": {
    "c1_robots": "robots.txt AI Policy",
    "c2_llms_txt": "llms.txt Present",
    "c3_bot_access": "Bot Accessibility",
    "c4_structured_data": "Structured Data",
    "c5_extractability": "Content Extractability",
    "robots_not_found": "robots.txt not found",
    "robots_ai_blocked": "AI bots are blocked",
    "robots_no_ai_rules": "No AI-specific rules found",
    "robots_ai_allowed": "AI bots explicitly allowed",
    "robots_fetch_error": "Could not fetch robots.txt",
    "llms_txt_found": "llms.txt found",
    "llms_txt_empty": "llms.txt exists but is empty",
    "llms_txt_missing": "llms.txt not found",
    "llms_txt_fetch_error": "Could not check llms.txt",
    "bots_all_accessible": "All bots can access site",
    "bots_all_blocked": "All bots are blocked",
    "bots_partially_blocked": "Some bots are blocked",
    "structured_data_found": "JSON-LD schema found",
    "structured_data_microdata_only": "Only microdata found (no JSON-LD)",
    "structured_data_missing": "No structured data found",
    "structured_data_fetch_error": "Could not check structured data",
    "extractability_good": "Content is extractable",
    "extractability_low": "Limited extractable content",
    "extractability_poor": "Very little extractable content",
    "extractability_fetch_error": "Could not check content",
    "check_error": "Check failed"
  },
  "pulse": {
    "title": "AI Pulse",
    "sov": "Share of Voice",
    "mentions": "Brand Mentions",
    "sentiment": "Avg Sentiment",
    "sov_trend": "SoV Trend (8 Weeks)",
    "platform_breakdown": "By Platform",
    "missed_title": "Missed Opportunities",
    "missed_subtitle": "Queries where your brand was not mentioned",
    "missed_platform": "Platform",
    "missed_question": "Query",
    "missed_competitors": "Competitors Mentioned",
    "sentiment_positive": "Positive",
    "sentiment_neutral": "Neutral",
    "sentiment_negative": "Negative"
  }
}
```

- [ ] **Step 2: Create `messages/zh-HK.json`**
```json
{
  "nav": { "title": "Fimmick AEO", "en": "EN", "zh": "中文" },
  "home": {
    "badge": "免費 AI 可見度檢測",
    "headline": "你的網站\nAI 搜尋搵到嗎？",
    "subheadline": "30 秒完成，免費修復包。",
    "placeholder": "https://yourwebsite.com",
    "cta": "立即掃描 →",
    "trust": "檢查 robots.txt · llms.txt · Bot 訪問 · Schema · 內容"
  },
  "result": {
    "score_label": "AI 就緒分數",
    "score_good": "優秀",
    "score_ok": "需要改善",
    "score_bad": "嚴重問題",
    "checks_title": "5 項檢測",
    "fix_cta": "生成修復包",
    "fix_subtitle": "llms.txt · robots 修補 · FAQ JSON-LD",
    "copy": "複製",
    "copied": "已複製！"
  },
  "checks": {
    "c1_robots": "robots.txt AI 政策",
    "c2_llms_txt": "llms.txt 存在",
    "c3_bot_access": "Bot 可訪問性",
    "c4_structured_data": "結構化數據",
    "c5_extractability": "內容可提取性",
    "robots_not_found": "找不到 robots.txt",
    "robots_ai_blocked": "AI Bot 被封鎖",
    "robots_no_ai_rules": "未找到 AI 相關規則",
    "robots_ai_allowed": "已明確允許 AI Bot",
    "robots_fetch_error": "無法獲取 robots.txt",
    "llms_txt_found": "已找到 llms.txt",
    "llms_txt_empty": "llms.txt 存在但內容為空",
    "llms_txt_missing": "找不到 llms.txt",
    "llms_txt_fetch_error": "無法檢查 llms.txt",
    "bots_all_accessible": "所有 Bot 可正常訪問",
    "bots_all_blocked": "所有 Bot 均被封鎖",
    "bots_partially_blocked": "部分 Bot 被封鎖",
    "structured_data_found": "已找到 JSON-LD Schema",
    "structured_data_microdata_only": "只有 Microdata（無 JSON-LD）",
    "structured_data_missing": "未找到結構化數據",
    "structured_data_fetch_error": "無法檢查結構化數據",
    "extractability_good": "內容可提取",
    "extractability_low": "可提取內容有限",
    "extractability_poor": "幾乎無可提取內容",
    "extractability_fetch_error": "無法檢查內容",
    "check_error": "檢測失敗"
  },
  "pulse": {
    "title": "AI Pulse",
    "sov": "品牌曝光率",
    "mentions": "品牌提及次數",
    "sentiment": "平均情感",
    "sov_trend": "曝光率趨勢（8週）",
    "platform_breakdown": "各平台分析",
    "missed_title": "錯失機會",
    "missed_subtitle": "未提及你品牌的查詢",
    "missed_platform": "平台",
    "missed_question": "問題",
    "missed_competitors": "提及的競品",
    "sentiment_positive": "正面",
    "sentiment_neutral": "中性",
    "sentiment_negative": "負面"
  }
}
```

- [ ] **Step 3: Create `middleware.ts`**
```typescript
import createMiddleware from 'next-intl/middleware'

export default createMiddleware({
  locales: ['en', 'zh-HK'],
  defaultLocale: 'en',
  localePrefix: 'always',
})

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
}
```

- [ ] **Step 4: Update `next.config.ts`**
```typescript
import { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin()

const nextConfig: NextConfig = {}

export default withNextIntl(nextConfig)
```

- [ ] **Step 5: Create `app/[lang]/layout.tsx`**
```typescript
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'

const locales = ['en', 'zh-HK']

export default async function LangLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  if (!locales.includes(lang)) notFound()

  const messages = await getMessages()

  return (
    <NextIntlClientProvider messages={messages}>
      {children}
    </NextIntlClientProvider>
  )
}
```

- [ ] **Step 6: Verify build compiles**
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**
```bash
git add messages/ middleware.ts next.config.ts app/
git commit -m "feat: add next-intl i18n (EN + ZH-HK), layout"
```

---

## Task 5: Check Module — robots.ts

**Files:**
- Create: `lib/checks/robots.ts`
- Create: `__tests__/checks/robots.test.ts`

- [ ] **Step 1: Write failing test**
```typescript
// __tests__/checks/robots.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkRobots } from '@/lib/checks/robots'

beforeEach(() => { vi.restoreAllMocks() })

describe('checkRobots', () => {
  it('returns pass when AI bot explicitly allowed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'User-agent: GPTBot\nAllow: /\n',
    }))
    const result = await checkRobots('https://example.com')
    expect(result.status).toBe('pass')
  })

  it('returns fail when AI bot is disallowed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'User-agent: GPTBot\nDisallow: /\n',
    }))
    const result = await checkRobots('https://example.com')
    expect(result.status).toBe('fail')
  })

  it('returns warn when no AI rules found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'User-agent: *\nAllow: /\n',
    }))
    const result = await checkRobots('https://example.com')
    expect(result.status).toBe('warn')
  })

  it('returns fail when robots.txt not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: async () => '' }))
    const result = await checkRobots('https://example.com')
    expect(result.status).toBe('fail')
  })
})
```

- [ ] **Step 2: Run test — expect failure**
```bash
npm test -- __tests__/checks/robots.test.ts
```
Expected: FAIL — `checkRobots` not found.

- [ ] **Step 3: Create `lib/checks/robots.ts`**
```typescript
import type { CheckResult } from '@/lib/types'

const AI_BOTS = ['gptbot', 'claudebot', 'perplexitybot', 'anthropic-ai', 'google-extended']

export async function checkRobots(baseUrl: string): Promise<CheckResult> {
  const robotsUrl = new URL('/robots.txt', baseUrl).toString()

  try {
    const res = await fetch(robotsUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Fimmick-AEO/1.0' },
    })

    if (!res.ok) return { status: 'fail', message: 'robots_not_found' }

    const lower = (await res.text()).toLowerCase()

    const hasBlock = AI_BOTS.some(bot => {
      const idx = lower.indexOf(`user-agent: ${bot}`)
      if (idx === -1) return false
      const next = lower.indexOf('user-agent:', idx + 1)
      const section = next === -1 ? lower.slice(idx) : lower.slice(idx, next)
      return section.includes('disallow: /')
    })

    if (hasBlock) return { status: 'fail', message: 'robots_ai_blocked' }

    const hasAllow = AI_BOTS.some(bot => lower.includes(`user-agent: ${bot}`))
    if (hasAllow) return { status: 'pass', message: 'robots_ai_allowed' }

    return { status: 'warn', message: 'robots_no_ai_rules' }
  } catch {
    return { status: 'fail', message: 'robots_fetch_error' }
  }
}
```

- [ ] **Step 4: Run test — expect pass**
```bash
npm test -- __tests__/checks/robots.test.ts
```
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/checks/robots.ts __tests__/checks/robots.test.ts
git commit -m "feat: add robots.txt check (C1) with tests"
```

---

## Task 6: Check Module — llmsTxt.ts

**Files:**
- Create: `lib/checks/llmsTxt.ts`
- Create: `__tests__/checks/llmsTxt.test.ts`

- [ ] **Step 1: Write failing test**
```typescript
// __tests__/checks/llmsTxt.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkLlmsTxt } from '@/lib/checks/llmsTxt'

beforeEach(() => { vi.restoreAllMocks() })

describe('checkLlmsTxt', () => {
  it('returns pass when llms.txt has content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '# About\nThis site sells widgets.',
    }))
    const result = await checkLlmsTxt('https://example.com')
    expect(result.status).toBe('pass')
  })

  it('returns warn when llms.txt is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '   ',
    }))
    const result = await checkLlmsTxt('https://example.com')
    expect(result.status).toBe('warn')
  })

  it('returns fail when llms.txt not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const result = await checkLlmsTxt('https://example.com')
    expect(result.status).toBe('fail')
  })
})
```

- [ ] **Step 2: Run test — expect failure**
```bash
npm test -- __tests__/checks/llmsTxt.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Create `lib/checks/llmsTxt.ts`**
```typescript
import type { CheckResult } from '@/lib/types'

export async function checkLlmsTxt(baseUrl: string): Promise<CheckResult> {
  const url = new URL('/llms.txt', baseUrl).toString()
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Fimmick-AEO/1.0' },
    })
    if (!res.ok) return { status: 'fail', message: 'llms_txt_missing' }
    const text = await res.text()
    if (text.trim().length === 0) return { status: 'warn', message: 'llms_txt_empty' }
    return { status: 'pass', message: 'llms_txt_found' }
  } catch {
    return { status: 'fail', message: 'llms_txt_fetch_error' }
  }
}
```

- [ ] **Step 4: Run test — expect pass**
```bash
npm test -- __tests__/checks/llmsTxt.test.ts
```
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/checks/llmsTxt.ts __tests__/checks/llmsTxt.test.ts
git commit -m "feat: add llms.txt check (C2) with tests"
```

---

## Task 7: Check Module — botAccess.ts

**Files:**
- Create: `lib/checks/botAccess.ts`
- Create: `__tests__/checks/botAccess.test.ts`

- [ ] **Step 1: Write failing test**
```typescript
// __tests__/checks/botAccess.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkBotAccess } from '@/lib/checks/botAccess'

beforeEach(() => { vi.restoreAllMocks() })

describe('checkBotAccess', () => {
  it('returns pass when all bots succeed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
    const result = await checkBotAccess('https://example.com')
    expect(result.status).toBe('pass')
  })

  it('returns fail when all bots are blocked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    const result = await checkBotAccess('https://example.com')
    expect(result.status).toBe('fail')
  })

  it('returns warn when some bots are blocked', async () => {
    let call = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      call++
      return Promise.resolve({ ok: call === 1, status: call === 1 ? 200 : 403 })
    }))
    const result = await checkBotAccess('https://example.com')
    expect(result.status).toBe('warn')
  })
})
```

- [ ] **Step 2: Run test — expect failure**
```bash
npm test -- __tests__/checks/botAccess.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Create `lib/checks/botAccess.ts`**
```typescript
import type { CheckResult } from '@/lib/types'

const BOTS = [
  { name: 'GPTBot',        ua: 'Mozilla/5.0 (compatible; GPTBot/1.3; +https://openai.com/gptbot)' },
  { name: 'ClaudeBot',     ua: 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +https://anthropic.com/)' },
  { name: 'PerplexityBot', ua: 'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/)' },
]

export async function checkBotAccess(url: string): Promise<CheckResult> {
  const results = await Promise.allSettled(
    BOTS.map(bot =>
      fetch(url, {
        headers: { 'User-Agent': bot.ua },
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      }),
    ),
  )

  const outcomes = results.map((r, i) => ({
    bot: BOTS[i].name,
    accessible: r.status === 'fulfilled' && r.value.ok,
  }))

  const blocked = outcomes.filter(o => !o.accessible)

  if (blocked.length === 0) return { status: 'pass', message: 'bots_all_accessible' }
  if (blocked.length === BOTS.length) return { status: 'fail', message: 'bots_all_blocked', details: blocked.map(b => b.bot).join(', ') }
  return { status: 'warn', message: 'bots_partially_blocked', details: blocked.map(b => b.bot).join(', ') }
}
```

- [ ] **Step 4: Run test — expect pass**
```bash
npm test -- __tests__/checks/botAccess.test.ts
```
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/checks/botAccess.ts __tests__/checks/botAccess.test.ts
git commit -m "feat: add bot access check (C3) with tests"
```

---

## Task 8: Check Module — structuredData.ts

**Files:**
- Create: `lib/checks/structuredData.ts`
- Create: `__tests__/checks/structuredData.test.ts`

- [ ] **Step 1: Write failing test**
```typescript
// __tests__/checks/structuredData.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkStructuredData } from '@/lib/checks/structuredData'

beforeEach(() => { vi.restoreAllMocks() })

describe('checkStructuredData', () => {
  it('returns pass when JSON-LD found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<script type="application/ld+json">{"@type":"WebSite"}</script>',
    }))
    const result = await checkStructuredData('https://example.com')
    expect(result.status).toBe('pass')
  })

  it('returns warn when only microdata found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<div itemtype="https://schema.org/Product" itemscope>test</div>',
    }))
    const result = await checkStructuredData('https://example.com')
    expect(result.status).toBe('warn')
  })

  it('returns fail when no structured data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body><p>Hello</p></body></html>',
    }))
    const result = await checkStructuredData('https://example.com')
    expect(result.status).toBe('fail')
  })
})
```

- [ ] **Step 2: Run test — expect failure**
```bash
npm test -- __tests__/checks/structuredData.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Create `lib/checks/structuredData.ts`**
```typescript
import type { CheckResult } from '@/lib/types'

export async function checkStructuredData(url: string): Promise<CheckResult> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Fimmick-AEO/1.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return { status: 'fail', message: 'structured_data_fetch_error' }

    const html = await res.text()
    const jsonLd = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>/gi)
    if (jsonLd?.length) return { status: 'pass', message: 'structured_data_found', details: `${jsonLd.length} block(s)` }
    if (html.includes('itemtype=') || html.includes('itemscope')) return { status: 'warn', message: 'structured_data_microdata_only' }
    return { status: 'fail', message: 'structured_data_missing' }
  } catch {
    return { status: 'fail', message: 'structured_data_fetch_error' }
  }
}
```

- [ ] **Step 4: Run test — expect pass**
```bash
npm test -- __tests__/checks/structuredData.test.ts
```
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/checks/structuredData.ts __tests__/checks/structuredData.test.ts
git commit -m "feat: add structured data check (C4) with tests"
```

---

## Task 9: Check Module — extractability.ts

**Files:**
- Create: `lib/checks/extractability.ts`
- Create: `__tests__/checks/extractability.test.ts`

- [ ] **Step 1: Write failing test**
```typescript
// __tests__/checks/extractability.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkExtractability } from '@/lib/checks/extractability'

beforeEach(() => { vi.restoreAllMocks() })

describe('checkExtractability', () => {
  it('returns pass when 200+ words present', async () => {
    const words = Array(250).fill('word').join(' ')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `<html><body><p>${words}</p></body></html>`,
    }))
    const result = await checkExtractability('https://example.com')
    expect(result.status).toBe('pass')
  })

  it('returns warn when 50–199 words', async () => {
    const words = Array(80).fill('word').join(' ')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `<html><body><p>${words}</p></body></html>`,
    }))
    const result = await checkExtractability('https://example.com')
    expect(result.status).toBe('warn')
  })

  it('returns fail when fewer than 50 words', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body><p>hello</p></body></html>',
    }))
    const result = await checkExtractability('https://example.com')
    expect(result.status).toBe('fail')
  })
})
```

- [ ] **Step 2: Run test — expect failure**
```bash
npm test -- __tests__/checks/extractability.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Create `lib/checks/extractability.ts`**
```typescript
import type { CheckResult } from '@/lib/types'

export async function checkExtractability(url: string): Promise<CheckResult> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Fimmick-AEO/1.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return { status: 'fail', message: 'extractability_fetch_error' }

    const html = await res.text()
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    const wordCount = stripped.split(' ').filter(w => w.length > 2).length

    if (wordCount >= 200) return { status: 'pass', message: 'extractability_good', details: `~${wordCount} words` }
    if (wordCount >= 50)  return { status: 'warn', message: 'extractability_low',  details: `~${wordCount} words` }
    return { status: 'fail', message: 'extractability_poor', details: `~${wordCount} words` }
  } catch {
    return { status: 'fail', message: 'extractability_fetch_error' }
  }
}
```

- [ ] **Step 4: Run test — expect pass**
```bash
npm test -- __tests__/checks/extractability.test.ts
```
Expected: 3 tests PASS.

- [ ] **Step 5: Run all check tests together**
```bash
npm test -- __tests__/checks/
```
Expected: 16 tests PASS across all 5 check modules.

- [ ] **Step 6: Commit**
```bash
git add lib/checks/extractability.ts __tests__/checks/extractability.test.ts
git commit -m "feat: add extractability check (C5) with tests — all 5 checks complete"
```

---

## Task 10: Scan API

**Files:**
- Create: `app/api/scan/route.ts`
- Create: `__tests__/api/scan.test.ts`

- [ ] **Step 1: Write failing test**
```typescript
// __tests__/api/scan.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all check modules
vi.mock('@/lib/checks/robots',         () => ({ checkRobots:         vi.fn().mockResolvedValue({ status: 'pass', message: 'robots_ai_allowed' }) }))
vi.mock('@/lib/checks/llmsTxt',        () => ({ checkLlmsTxt:        vi.fn().mockResolvedValue({ status: 'fail', message: 'llms_txt_missing' }) }))
vi.mock('@/lib/checks/botAccess',      () => ({ checkBotAccess:      vi.fn().mockResolvedValue({ status: 'pass', message: 'bots_all_accessible' }) }))
vi.mock('@/lib/checks/structuredData', () => ({ checkStructuredData: vi.fn().mockResolvedValue({ status: 'pass', message: 'structured_data_found' }) }))
vi.mock('@/lib/checks/extractability', () => ({ checkExtractability: vi.fn().mockResolvedValue({ status: 'pass', message: 'extractability_good' }) }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'test-uuid' }, error: null }),
        }),
      }),
    }),
  },
}))

import { calculateScore } from '@/app/api/scan/route'

describe('calculateScore', () => {
  it('gives C3 30% weight, others 17.5%', () => {
    const results = {
      c1_robots:         { status: 'pass' as const, message: '' },
      c2_llms_txt:       { status: 'fail' as const, message: '' },
      c3_bot_access:     { status: 'pass' as const, message: '' },
      c4_structured_data:{ status: 'pass' as const, message: '' },
      c5_extractability: { status: 'pass' as const, message: '' },
    }
    // pass=100: c1(17.5) + c3(30) + c4(17.5) + c5(17.5) = 82.5
    expect(calculateScore(results)).toBeCloseTo(82.5)
  })

  it('returns 0 when all checks fail', () => {
    const results = {
      c1_robots:         { status: 'fail' as const, message: '' },
      c2_llms_txt:       { status: 'fail' as const, message: '' },
      c3_bot_access:     { status: 'fail' as const, message: '' },
      c4_structured_data:{ status: 'fail' as const, message: '' },
      c5_extractability: { status: 'fail' as const, message: '' },
    }
    expect(calculateScore(results)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test — expect failure**
```bash
npm test -- __tests__/api/scan.test.ts
```
Expected: FAIL — `calculateScore` not exported.

- [ ] **Step 3: Create `app/api/scan/route.ts`**
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { checkRobots }         from '@/lib/checks/robots'
import { checkLlmsTxt }        from '@/lib/checks/llmsTxt'
import { checkBotAccess }      from '@/lib/checks/botAccess'
import { checkStructuredData } from '@/lib/checks/structuredData'
import { checkExtractability } from '@/lib/checks/extractability'
import { supabase }            from '@/lib/supabase'
import type { ScanResults }    from '@/lib/types'

const WEIGHTS = {
  c1_robots:          0.175,
  c2_llms_txt:        0.175,
  c3_bot_access:      0.300,
  c4_structured_data: 0.175,
  c5_extractability:  0.175,
}
const SCORES = { pass: 100, warn: 50, fail: 0 } as const

export function calculateScore(results: ScanResults): number {
  return (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).reduce((total, key) => {
    return total + SCORES[results[key].status] * WEIGHTS[key]
  }, 0)
}

export async function POST(req: NextRequest) {
  const { url } = await req.json()
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  let baseUrl: string
  let domain: string
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`)
    baseUrl = parsed.origin
    domain  = parsed.hostname
  } catch {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
  }

  const [c1, c2, c3, c4, c5] = await Promise.allSettled([
    checkRobots(baseUrl),
    checkLlmsTxt(baseUrl),
    checkBotAccess(baseUrl),
    checkStructuredData(baseUrl),
    checkExtractability(baseUrl),
  ])

  const get = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
    r.status === 'fulfilled' ? r.value : fallback
  const err = { status: 'fail' as const, message: 'check_error' }

  const results: ScanResults = {
    c1_robots:          get(c1, err),
    c2_llms_txt:        get(c2, err),
    c3_bot_access:      get(c3, err),
    c4_structured_data: get(c4, err),
    c5_extractability:  get(c5, err),
  }

  const score = calculateScore(results)

  const { data, error } = await supabase
    .from('scans')
    .insert({ url: baseUrl, domain, score, results })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 })

  return NextResponse.json({ id: data.id, score, results })
}
```

- [ ] **Step 4: Run test — expect pass**
```bash
npm test -- __tests__/api/scan.test.ts
```
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**
```bash
git add app/api/scan/ __tests__/api/scan.test.ts
git commit -m "feat: add scan API with score calculation"
```

---

## Task 11: Fix API

**Files:**
- Create: `app/api/fix/route.ts`
- Create: `__tests__/api/fix.test.ts`

- [ ] **Step 1: Write failing test**
```typescript
// __tests__/api/fix.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFixPack = { llms_txt: '# About', robots_patch: 'Allow: /', faq_schema: '{}' }

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockImplementation((table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'scan-1', url: 'https://example.com', domain: 'example.com',
          results: { c2_llms_txt: { status: 'fail', message: 'llms_txt_missing' } },
        },
        error: null,
      }),
    })),
  },
}))

vi.mock('@/lib/openrouter', () => ({
  callOpenRouter: vi.fn().mockResolvedValue(JSON.stringify(mockFixPack)),
}))

vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  text: async () => '<title>Example</title>',
}))

import { parseFixPack } from '@/app/api/fix/route'

describe('parseFixPack', () => {
  it('extracts JSON from LLM response', () => {
    const raw = 'Here is the fix: {"llms_txt": "hello", "robots_patch": "x", "faq_schema": "y"}'
    const result = parseFixPack(raw)
    expect(result).toEqual({ llms_txt: 'hello', robots_patch: 'x', faq_schema: 'y' })
  })

  it('handles clean JSON response', () => {
    const raw = '{"llms_txt": "a", "robots_patch": "b", "faq_schema": "c"}'
    const result = parseFixPack(raw)
    expect(result).toEqual({ llms_txt: 'a', robots_patch: 'b', faq_schema: 'c' })
  })
})
```

- [ ] **Step 2: Run test — expect failure**
```bash
npm test -- __tests__/api/fix.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Create `app/api/fix/route.ts`**
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { supabase }        from '@/lib/supabase'
import { callOpenRouter }  from '@/lib/openrouter'

export function parseFixPack(raw: string): { llms_txt: string; robots_patch: string; faq_schema: string } {
  const match = raw.match(/\{[\s\S]*\}/)
  return JSON.parse(match?.[0] ?? raw)
}

export async function POST(req: NextRequest) {
  const { scanId } = await req.json()
  if (!scanId) return NextResponse.json({ error: 'Missing scanId' }, { status: 400 })

  // Return cached fix pack if it exists
  const { data: existing } = await supabase
    .from('fix_packs')
    .select('llms_txt, robots_patch, faq_schema')
    .eq('scan_id', scanId)
    .maybeSingle()

  if (existing) return NextResponse.json(existing)

  const { data: scan, error: scanError } = await supabase
    .from('scans')
    .select('*')
    .eq('id', scanId)
    .single()

  if (scanError || !scan) return NextResponse.json({ error: 'Scan not found' }, { status: 404 })

  let pageTitle = scan.domain
  let metaDescription = ''
  try {
    const res = await fetch(scan.url, { signal: AbortSignal.timeout(8000) })
    const html = await res.text()
    const t = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    if (t) pageTitle = t[1].trim()
    const m = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
    if (m) metaDescription = m[1].trim()
  } catch { /* use defaults */ }

  const issues = Object.entries(scan.results as Record<string, { status: string; message: string }>)
    .filter(([, v]) => v.status !== 'pass')
    .map(([k, v]) => `${k}: ${v.message}`)

  const raw = await callOpenRouter({
    model: 'anthropic/claude-haiku-4-5',
    maxTokens: 2000,
    messages: [{
      role: 'user',
      content: `你係 AEO 專家。根據以下掃描結果，生成 3 個修復檔案：
1. llms.txt（根據網站描述）
2. robots.txt AI section（只需新增部份）
3. FAQPage JSON-LD（2–3 條 FAQ）

網站：${scan.domain}
描述：${pageTitle} - ${metaDescription}
問題：${JSON.stringify(issues)}

輸出 JSON（只輸出 JSON，無其他文字）：{ "llms_txt": "...", "robots_patch": "...", "faq_schema": "..." }`,
    }],
  })

  let parsed: { llms_txt: string; robots_patch: string; faq_schema: string }
  try {
    parsed = parseFixPack(raw)
  } catch {
    return NextResponse.json({ error: 'Failed to parse LLM response' }, { status: 500 })
  }

  await supabase.from('fix_packs').insert({ scan_id: scanId, ...parsed })

  return NextResponse.json(parsed)
}
```

- [ ] **Step 4: Run test — expect pass**
```bash
npm test -- __tests__/api/fix.test.ts
```
Expected: 2 tests PASS.

- [ ] **Step 5: Run full test suite**
```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 6: Commit**
```bash
git add app/api/fix/ __tests__/api/fix.test.ts
git commit -m "feat: add fix API with OpenRouter Fix Pack generation"
```

---

## Task 12: UI Components (ScoreRing, CheckItem, FixPackBlock)

**Files:**
- Create: `components/ScoreRing.tsx`
- Create: `components/CheckItem.tsx`
- Create: `components/FixPackBlock.tsx`

- [ ] **Step 1: Create `components/ScoreRing.tsx`**
```typescript
'use client'

interface Props { score: number }

function getColor(score: number) {
  if (score >= 80) return { ring: '#16a34a', bg: '#dcfce7', text: '#15803d' }
  if (score >= 50) return { ring: '#d97706', bg: '#fef3c7', text: '#b45309' }
  return { ring: '#dc2626', bg: '#fee2e2', text: '#b91c1c' }
}

export function ScoreRing({ score }: Props) {
  const { ring, bg, text } = getColor(score)
  return (
    <div
      className="flex items-center justify-center rounded-full w-20 h-20 text-2xl font-black"
      style={{ background: bg, border: `4px solid ${ring}`, color: text }}
    >
      {Math.round(score)}
    </div>
  )
}
```

- [ ] **Step 2: Create `components/CheckItem.tsx`**
```typescript
import type { CheckResult } from '@/lib/types'

const ICONS = { pass: '✅', warn: '⚠️', fail: '❌' }
const COLORS = {
  pass: 'text-green-700',
  warn: 'text-amber-700',
  fail: 'text-red-700',
}

interface Props {
  label: string
  result: CheckResult
  message: string
}

export function CheckItem({ label, result, message }: Props) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-700">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`text-sm ${COLORS[result.status]}`}>{message}</span>
        <span>{ICONS[result.status]}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `components/FixPackBlock.tsx`**
```typescript
'use client'
import { useState } from 'react'

interface Props {
  title: string
  content: string
  copyLabel: string
  copiedLabel: string
}

export function FixPackBlock({ title, content, copyLabel, copiedLabel }: Props) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200">
        <span className="text-sm font-semibold text-slate-700">{title}</span>
        <button
          onClick={handleCopy}
          className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
      <pre className="p-4 text-xs text-slate-800 overflow-x-auto whitespace-pre-wrap font-mono">
        {content}
      </pre>
    </div>
  )
}
```

- [ ] **Step 4: Commit**
```bash
git add components/
git commit -m "feat: add ScoreRing, CheckItem, FixPackBlock components"
```

---

## Task 13: Home Page

**Files:**
- Create: `app/[lang]/page.tsx`

- [ ] **Step 1: Create `app/[lang]/page.tsx`**
```typescript
'use client'
import { useTranslations } from 'next-intl'
import { useRouter, useParams } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'

export default function HomePage() {
  const t    = useTranslations()
  const router = useRouter()
  const params = useParams<{ lang: string }>()
  const [url, setUrl]       = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')

  async function handleScan(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (!res.ok) throw new Error('Scan failed')
      const data = await res.json()
      router.push(`/${params.lang}/result/${data.id}`)
    } catch {
      setError('Could not scan this URL. Please check it and try again.')
      setLoading(false)
    }
  }

  const otherLang = params.lang === 'en' ? 'zh-HK' : 'en'
  const otherLabel = params.lang === 'en' ? '中文' : 'EN'

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Nav */}
      <nav className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center">
        <span className="font-bold text-slate-900">
          Fimmick <span className="text-blue-600">AEO</span>
        </span>
        <Link href={`/${otherLang}`} className="text-sm text-blue-600 hover:underline">
          {otherLabel}
        </Link>
      </nav>

      {/* Hero */}
      <main className="max-w-xl mx-auto px-6 py-20 text-center">
        <span className="inline-block bg-blue-100 text-blue-700 text-xs font-semibold tracking-widest px-4 py-1 rounded-full mb-6">
          {t('home.badge')}
        </span>
        <h1 className="text-4xl font-black text-slate-900 leading-tight mb-3 whitespace-pre-line">
          {t('home.headline')}
        </h1>
        <p className="text-slate-500 mb-10">{t('home.subheadline')}</p>

        <form onSubmit={handleScan} className="flex gap-2">
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder={t('home.placeholder')}
            className="flex-1 border-2 border-blue-600 rounded-lg px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-300"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {loading ? '…' : t('home.cta')}
          </button>
        </form>

        {error && <p className="text-red-600 text-sm mt-3">{error}</p>}

        <p className="text-xs text-slate-400 mt-6">{t('home.trust')}</p>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Test manually**

```bash
npm run dev
```
Open http://localhost:3000 — should redirect to http://localhost:3000/en. Enter a URL, click Scan. Should redirect to `/en/result/[uuid]` (result page will 404 — that's fine, next task builds it).

- [ ] **Step 3: Commit**
```bash
git add app/
git commit -m "feat: add home page with URL input and scan trigger"
```

---

## Task 14: Result Page

**Files:**
- Create: `app/[lang]/result/[id]/page.tsx`

- [ ] **Step 1: Create `app/[lang]/result/[id]/page.tsx`**
```typescript
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { supabase }     from '@/lib/supabase'
import { ScoreRing }    from '@/components/ScoreRing'
import { CheckItem }    from '@/components/CheckItem'
import { FixPackClient } from '@/components/FixPackClient'
import type { Scan }    from '@/lib/types'

const CHECK_KEYS = ['c1_robots', 'c2_llms_txt', 'c3_bot_access', 'c4_structured_data', 'c5_extractability'] as const

export default async function ResultPage({ params }: { params: Promise<{ lang: string; id: string }> }) {
  const { lang, id } = await params
  const t = await getTranslations()

  const { data: scan } = await supabase.from('scans').select('*').eq('id', id).single()
  if (!scan) notFound()

  const s = scan as Scan
  const scoreLabel = s.score >= 80 ? t('result.score_good') : s.score >= 50 ? t('result.score_ok') : t('result.score_bad')

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center">
        <Link href={`/${lang}`} className="font-bold text-slate-900">
          Fimmick <span className="text-blue-600">AEO</span>
        </Link>
        <Link href={`/${lang === 'en' ? 'zh-HK' : 'en'}/result/${id}`} className="text-sm text-blue-600 hover:underline">
          {lang === 'en' ? '中文' : 'EN'}
        </Link>
      </nav>

      <main className="max-w-xl mx-auto px-6 py-10">
        {/* Score card */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 flex items-center gap-5">
          <ScoreRing score={s.score} />
          <div>
            <p className="text-lg font-bold text-slate-900">{s.domain}</p>
            <p className="text-sm text-slate-500">{t('result.score_label')} — {scoreLabel}</p>
          </div>
        </div>

        {/* Checks */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <p className="text-xs font-bold text-slate-500 tracking-widest mb-4">{t('result.checks_title')}</p>
          {CHECK_KEYS.map(key => (
            <CheckItem
              key={key}
              label={t(`checks.${key}`)}
              result={s.results[key]}
              message={t(`checks.${s.results[key].message}`)}
            />
          ))}
        </div>

        {/* Fix Pack */}
        <FixPackClient
          scanId={s.id}
          fixCta={t('result.fix_cta')}
          fixSubtitle={t('result.fix_subtitle')}
          copyLabel={t('result.copy')}
          copiedLabel={t('result.copied')}
        />
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Create `components/FixPackClient.tsx`** (client component for Fix Pack generation)
```typescript
'use client'
import { useState } from 'react'
import { FixPackBlock } from '@/components/FixPackBlock'

interface Props {
  scanId: string
  fixCta: string
  fixSubtitle: string
  copyLabel: string
  copiedLabel: string
}

export function FixPackClient({ scanId, fixCta, fixSubtitle, copyLabel, copiedLabel }: Props) {
  const [loading, setLoading] = useState(false)
  const [fixPack, setFixPack] = useState<{ llms_txt: string; robots_patch: string; faq_schema: string } | null>(null)

  async function generate() {
    setLoading(true)
    const res = await fetch('/api/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanId }),
    })
    const data = await res.json()
    setFixPack(data)
    setLoading(false)
  }

  if (fixPack) {
    return (
      <div className="space-y-4">
        <FixPackBlock title="llms.txt"         content={fixPack.llms_txt}      copyLabel={copyLabel} copiedLabel={copiedLabel} />
        <FixPackBlock title="robots.txt patch" content={fixPack.robots_patch}  copyLabel={copyLabel} copiedLabel={copiedLabel} />
        <FixPackBlock title="FAQ JSON-LD"      content={fixPack.faq_schema}    copyLabel={copyLabel} copiedLabel={copiedLabel} />
      </div>
    )
  }

  return (
    <div className="bg-blue-600 rounded-xl p-6 text-center">
      <button
        onClick={generate}
        disabled={loading}
        className="text-white font-bold text-lg disabled:opacity-70"
      >
        {loading ? '…' : fixCta}
      </button>
      <p className="text-blue-200 text-sm mt-1">{fixSubtitle}</p>
    </div>
  )
}
```

- [ ] **Step 3: Test manually — end-to-end Phase 1**

```bash
npm run dev
```
1. Go to http://localhost:3000/en
2. Enter a real URL (e.g. `https://fimmick.com`)
3. Wait for redirect to result page (~15–30 seconds)
4. Confirm: score ring shows a number, 5 check rows appear
5. Click "Generate Fix Pack" — wait ~10 seconds
6. Confirm: 3 code blocks appear with copy buttons

- [ ] **Step 4: Commit**
```bash
git add app/ components/
git commit -m "feat: add result page with score, checks, and fix pack UI"
```

---

## Task 15: Deploy Phase 1 to Vercel

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: Create `vercel.json`** (increase serverless function timeout for scan)
```json
{
  "functions": {
    "app/api/scan/route.ts": { "maxDuration": 60 },
    "app/api/fix/route.ts":  { "maxDuration": 30 }
  }
}
```

- [ ] **Step 2: Push to GitHub**

Create a new GitHub repo (e.g. `fimmick-aeo`), then:
```bash
git remote add origin https://github.com/<your-org>/fimmick-aeo.git
git push -u origin main
```

- [ ] **Step 3: Create Vercel project**

Use `mcp__0997b62b__deploy_to_vercel` or via Vercel dashboard: import the GitHub repo.

- [ ] **Step 4: Add environment variables in Vercel**

In Vercel dashboard → Settings → Environment Variables, add:
- `OPENROUTER_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

- [ ] **Step 5: Trigger deployment and verify**

Wait for build to complete. Visit the Vercel URL, run a real scan end-to-end.

- [ ] **Step 6: Commit vercel.json**
```bash
git add vercel.json
git commit -m "chore: add vercel.json with extended function timeouts"
git push
```

---

## Task 16: Supabase Migrations — Phase 2

**Files:**
- Create: `supabase/migrations/002_phase2.sql`

- [ ] **Step 1: Create migration file**
```sql
-- supabase/migrations/002_phase2.sql
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  brand_name text not null,
  industry text,
  competitors text[],
  status text default 'active',
  created_at timestamptz default now()
);

create table if not exists prompt_bank (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  category text,
  question text not null,
  language text default 'zh-HK',
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists pulse_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  prompt_id uuid references prompt_bank(id),
  platform text not null,
  question text not null,
  raw_answer text,
  brand_mentioned boolean,
  sentiment text,
  mention_position int,
  competitors_mentioned text[],
  scan_week date not null,
  created_at timestamptz default now()
);

create table if not exists pulse_weekly_summary (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  scan_week date not null,
  platform text,
  total_queries int,
  brand_mentions int,
  sov_score numeric(5,2),
  avg_sentiment_score numeric(3,2),
  top_competitors jsonb,
  created_at timestamptz default now()
);
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use `mcp__ebffcbd7__apply_migration` with:
- `project_id`: `ggudkqnxglvydplqmcbh`
- `name`: `002_phase2`
- SQL content above

- [ ] **Step 3: Verify tables exist**

Use `mcp__ebffcbd7__list_tables`. Expected: `clients`, `prompt_bank`, `pulse_metrics`, `pulse_weekly_summary` all present.

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/002_phase2.sql
git commit -m "feat: add Phase 2 Supabase schema (clients, prompt_bank, pulse_metrics, pulse_weekly_summary)"
```

---

## Task 17: Pulse Onboard API

**Files:**
- Create: `app/api/pulse/onboard/route.ts`

- [ ] **Step 1: Create `app/api/pulse/onboard/route.ts`**
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { supabase }       from '@/lib/supabase'
import { callOpenRouter } from '@/lib/openrouter'

export async function POST(req: NextRequest) {
  const { brandName, industry, competitors } = await req.json()

  if (!brandName) return NextResponse.json({ error: 'brandName required' }, { status: 400 })

  // Insert client
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .insert({ brand_name: brandName, industry: industry ?? null, competitors: competitors ?? [] })
    .select('id')
    .single()

  if (clientError) return NextResponse.json({ error: 'DB error' }, { status: 500 })

  // Generate 50 prompts via OpenRouter
  const raw = await callOpenRouter({
    model: 'anthropic/claude-haiku-4-5',
    maxTokens: 4000,
    messages: [{
      role: 'user',
      content: `品牌：${brandName}
行業：${industry ?? '未指定'}
競品：${(competitors ?? []).join(', ') || '未指定'}

生成 50 條問題，分 4 類（brand_query/category_query/intent_query/pain_point），每類 12-13 條。
返回 JSON array（只輸出 array，無其他文字）：[{"category":"brand_query","question":"...","language":"zh-HK"}]`,
    }],
  })

  let prompts: Array<{ category: string; question: string; language: string }>
  try {
    const match = raw.match(/\[[\s\S]*\]/)
    prompts = JSON.parse(match?.[0] ?? raw)
  } catch {
    return NextResponse.json({ error: 'Failed to parse prompts' }, { status: 500 })
  }

  const rows = prompts.map(p => ({
    client_id: client.id,
    category: p.category,
    question: p.question,
    language: p.language ?? 'zh-HK',
  }))

  const { error: promptError } = await supabase.from('prompt_bank').insert(rows)
  if (promptError) return NextResponse.json({ error: 'Failed to save prompts' }, { status: 500 })

  return NextResponse.json({ clientId: client.id, promptCount: rows.length })
}
```

- [ ] **Step 2: Test manually — onboard Fimmick as pilot client**

```bash
curl -X POST http://localhost:3000/api/pulse/onboard \
  -H "Content-Type: application/json" \
  -d '{"brandName":"Fimmick","industry":"Digital Marketing Agency","competitors":["Isobar","GroupM HK","Cherrypicks"]}'
```
Expected: `{"clientId":"<uuid>","promptCount":50}` (or close to 50)

- [ ] **Step 3: Verify in Supabase**

Check `clients` and `prompt_bank` tables in Supabase dashboard. Confirm 1 client row and ~50 prompt rows.

- [ ] **Step 4: Commit**
```bash
git add app/api/pulse/
git commit -m "feat: add pulse onboard API — generates 50 prompts per client"
```

---

## Task 18: Pulse Summary and Missed APIs

**Files:**
- Create: `app/api/pulse/[clientId]/summary/route.ts`
- Create: `app/api/pulse/[clientId]/missed/route.ts`

- [ ] **Step 1: Create `app/api/pulse/[clientId]/summary/route.ts`**
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params

  const { data, error } = await supabase
    .from('pulse_weekly_summary')
    .select('*')
    .eq('client_id', clientId)
    .order('scan_week', { ascending: true })
    .limit(8)

  if (error) return NextResponse.json({ error: 'DB error' }, { status: 500 })
  return NextResponse.json(data)
}
```

- [ ] **Step 2: Create `app/api/pulse/[clientId]/missed/route.ts`**
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params

  const { data, error } = await supabase
    .from('pulse_metrics')
    .select('platform, question, competitors_mentioned, scan_week')
    .eq('client_id', clientId)
    .eq('brand_mentioned', false)
    .order('scan_week', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: 'DB error' }, { status: 500 })
  return NextResponse.json(data)
}
```

- [ ] **Step 3: Commit**
```bash
git add app/api/pulse/
git commit -m "feat: add pulse summary and missed-opportunities API routes"
```

---

## Task 19: Pulse Dashboard UI

**Files:**
- Create: `components/pulse/SovChart.tsx`
- Create: `components/pulse/PlatformBar.tsx`
- Create: `components/pulse/MissedTable.tsx`
- Create: `app/[lang]/pulse/[clientId]/page.tsx`

- [ ] **Step 1: Create `components/pulse/SovChart.tsx`**
```typescript
'use client'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { PulseWeeklySummary } from '@/lib/types'

interface Props { data: PulseWeeklySummary[] }

export function SovChart({ data }: Props) {
  const chartData = data
    .filter(d => !d.platform)
    .map(d => ({ week: d.scan_week.slice(5), sov: Number(d.sov_score) }))

  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={chartData}>
        <XAxis dataKey="week" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
        <Tooltip formatter={(v: number) => `${v}%`} />
        <Line type="monotone" dataKey="sov" stroke="#2563eb" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
```

- [ ] **Step 2: Create `components/pulse/PlatformBar.tsx`**
```typescript
'use client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { PulseWeeklySummary } from '@/lib/types'

interface Props { data: PulseWeeklySummary[] }

export function PlatformBar({ data }: Props) {
  const latest = data.at(-1)?.scan_week
  const chartData = data
    .filter(d => d.scan_week === latest && d.platform)
    .map(d => ({
      platform: d.platform!.replace('perplexity-', 'Perplx ').replace('gpt-4o', 'GPT-4o').replace('claude-haiku', 'Claude').replace('gemini-flash', 'Gemini'),
      sov: Number(d.sov_score),
    }))

  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={chartData} layout="vertical">
        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
        <YAxis type="category" dataKey="platform" tick={{ fontSize: 11 }} width={70} />
        <Tooltip formatter={(v: number) => `${v}%`} />
        <Bar dataKey="sov" fill="#2563eb" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
```

- [ ] **Step 3: Create `components/pulse/MissedTable.tsx`**
```typescript
interface Row {
  platform: string
  question: string
  competitors_mentioned: string[]
  scan_week: string
}

interface Props { rows: Row[]; platformLabel: string; questionLabel: string; competitorsLabel: string }

export function MissedTable({ rows, platformLabel, questionLabel, competitorsLabel }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="text-left py-2 pr-4 text-slate-500 font-medium">{platformLabel}</th>
            <th className="text-left py-2 pr-4 text-slate-500 font-medium">{questionLabel}</th>
            <th className="text-left py-2 text-slate-500 font-medium">{competitorsLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-100">
              <td className="py-2 pr-4 text-slate-600 whitespace-nowrap">{row.platform}</td>
              <td className="py-2 pr-4 text-slate-800">{row.question}</td>
              <td className="py-2 text-slate-500">{row.competitors_mentioned.join(', ') || '—'}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={3} className="py-4 text-center text-slate-400">No data yet</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 4: Create `app/[lang]/pulse/[clientId]/page.tsx`**
```typescript
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { supabase }    from '@/lib/supabase'
import { SovChart }    from '@/components/pulse/SovChart'
import { PlatformBar } from '@/components/pulse/PlatformBar'
import { MissedTable } from '@/components/pulse/MissedTable'
import type { PulseWeeklySummary, PulseMetric } from '@/lib/types'

export default async function PulsePage({ params }: { params: Promise<{ lang: string; clientId: string }> }) {
  const { lang, clientId } = await params
  const t = await getTranslations('pulse')

  const { data: client } = await supabase.from('clients').select('brand_name').eq('id', clientId).single()
  if (!client) notFound()

  const [{ data: summaryRaw }, { data: missedRaw }] = await Promise.all([
    supabase.from('pulse_weekly_summary').select('*').eq('client_id', clientId).order('scan_week').limit(40),
    supabase.from('pulse_metrics').select('platform,question,competitors_mentioned,scan_week').eq('client_id', clientId).eq('brand_mentioned', false).order('scan_week', { ascending: false }).limit(50),
  ])

  const summary = (summaryRaw ?? []) as PulseWeeklySummary[]
  const missed  = (missedRaw  ?? []) as PulseMetric[]

  const latestTotal = summary.filter(d => d.scan_week === summary.at(-1)?.scan_week && !d.platform)
  const kpi = latestTotal[0]

  const sentimentLabel = (s: number | undefined) => {
    if (!s) return '—'
    if (s > 0.3) return t('sentiment_positive')
    if (s < -0.3) return t('sentiment_negative')
    return t('sentiment_neutral')
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center">
        <span className="font-bold text-slate-900">
          Fimmick <span className="text-blue-600">{t('title')}</span>
          <span className="ml-2 text-sm font-normal text-slate-500">{client.brand_name}</span>
        </span>
        <span className="text-xs text-slate-400">{kpi?.scan_week ? `Week of ${kpi.scan_week}` : 'No data yet'}</span>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: t('sov'),      value: kpi ? `${kpi.sov_score}%` : '—' },
            { label: t('mentions'), value: kpi ? `${kpi.brand_mentions}/${kpi.total_queries}` : '—' },
            { label: t('sentiment'),value: sentimentLabel(kpi?.avg_sentiment_score) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 p-5 text-center">
              <p className="text-2xl font-black text-blue-600">{value}</p>
              <p className="text-xs text-slate-500 mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* SoV Trend */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <p className="text-sm font-semibold text-slate-700 mb-4">{t('sov_trend')}</p>
          <SovChart data={summary} />
        </div>

        {/* Platform Breakdown */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <p className="text-sm font-semibold text-slate-700 mb-4">{t('platform_breakdown')}</p>
          <PlatformBar data={summary} />
        </div>

        {/* Missed Opportunities */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <p className="text-sm font-semibold text-slate-700 mb-1">{t('missed_title')}</p>
          <p className="text-xs text-slate-400 mb-4">{t('missed_subtitle')}</p>
          <MissedTable
            rows={missed}
            platformLabel={t('missed_platform')}
            questionLabel={t('missed_question')}
            competitorsLabel={t('missed_competitors')}
          />
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 5: Commit**
```bash
git add components/pulse/ app/[lang]/pulse/
git commit -m "feat: add AI Pulse dashboard with SoV chart, platform bar, and missed table"
```

---

## Task 20: n8n Workflow

**Files:**
- Create: `n8n/ai-pulse-weekly.json`

- [ ] **Step 1: Create `n8n/ai-pulse-weekly.json`**
```json
{
  "name": "AI Pulse Weekly",
  "nodes": [
    {
      "parameters": { "rule": { "interval": [{ "field": "weeks" }] }, "triggerAtHour": 8, "triggerAtMinute": 0, "weekdays": [1] },
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "position": [0, 0]
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "SELECT c.id as client_id, c.brand_name, p.id as prompt_id, p.question, p.language FROM clients c JOIN prompt_bank p ON p.client_id = c.id WHERE c.status = 'active' AND p.is_active = true",
        "options": {}
      },
      "name": "Get Active Prompts",
      "type": "n8n-nodes-base.postgres",
      "position": [200, 0]
    },
    {
      "parameters": { "batchSize": 1, "options": {} },
      "name": "Split In Batches",
      "type": "n8n-nodes-base.splitInBatches",
      "position": [400, 0]
    },
    {
      "parameters": {
        "url": "https://openrouter.ai/api/v1/chat/completions",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "HTTP-Referer", "value": "https://aeo.fimmick.com" },
            { "name": "X-Title",      "value": "Fimmick AI Pulse" }
          ]
        },
        "sendBody": true,
        "bodyParameters": {
          "parameters": [
            { "name": "model",      "value": "perplexity/sonar" },
            { "name": "max_tokens", "value": 1000 },
            { "name": "messages",   "value": "={{ [{\"role\":\"user\",\"content\":$json.question}] }}" }
          ]
        }
      },
      "name": "Query Perplexity Sonar",
      "type": "n8n-nodes-base.httpRequest",
      "position": [600, -200]
    },
    {
      "parameters": {
        "url": "https://openrouter.ai/api/v1/chat/completions",
        "sendBody": true,
        "bodyParameters": {
          "parameters": [
            { "name": "model",    "value": "openai/gpt-4o" },
            { "name": "max_tokens","value": 1000 },
            { "name": "messages", "value": "={{ [{\"role\":\"user\",\"content\":$json.question}] }}" }
          ]
        }
      },
      "name": "Query GPT-4o",
      "type": "n8n-nodes-base.httpRequest",
      "position": [600, 0]
    },
    {
      "parameters": {
        "url": "https://openrouter.ai/api/v1/chat/completions",
        "sendBody": true,
        "bodyParameters": {
          "parameters": [
            { "name": "model",    "value": "anthropic/claude-haiku-4-5" },
            { "name": "max_tokens","value": 1000 },
            { "name": "messages", "value": "={{ [{\"role\":\"user\",\"content\":$json.question}] }}" }
          ]
        }
      },
      "name": "Query Claude Haiku",
      "type": "n8n-nodes-base.httpRequest",
      "position": [600, 200]
    },
    {
      "parameters": {
        "url": "https://openrouter.ai/api/v1/chat/completions",
        "sendBody": true,
        "bodyParameters": {
          "parameters": [
            { "name": "model",    "value": "google/gemini-flash-2.0" },
            { "name": "max_tokens","value": 1000 },
            { "name": "messages", "value": "={{ [{\"role\":\"user\",\"content\":$json.question}] }}" }
          ]
        }
      },
      "name": "Query Gemini Flash",
      "type": "n8n-nodes-base.httpRequest",
      "position": [600, 400]
    },
    {
      "parameters": {
        "url": "https://openrouter.ai/api/v1/chat/completions",
        "sendBody": true,
        "bodyParameters": {
          "parameters": [
            { "name": "model",    "value": "anthropic/claude-haiku-4-5" },
            { "name": "max_tokens","value": 300 },
            { "name": "messages", "value": "={{ [{\"role\":\"user\",\"content\":\"品牌：\" + $json.brand_name + \"\\n問題：\" + $json.question + \"\\n答案：\" + $json.raw_answer + \"\\n返回JSON：{\\\"brand_mentioned\\\":bool,\\\"sentiment\\\":\\\"positive/neutral/negative/not_mentioned\\\",\\\"mention_position\\\":number|null,\\\"competitors_mentioned\\\":[\\\"...\\\"]}\"}] }}" }
          ]
        }
      },
      "name": "Analyse with Claude",
      "type": "n8n-nodes-base.httpRequest",
      "position": [800, 0]
    },
    {
      "parameters": {
        "operation": "insert",
        "table": "pulse_metrics",
        "columns": "client_id,prompt_id,platform,question,raw_answer,brand_mentioned,sentiment,mention_position,competitors_mentioned,scan_week"
      },
      "name": "Write pulse_metrics",
      "type": "n8n-nodes-base.postgres",
      "position": [1000, 0]
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "INSERT INTO pulse_weekly_summary (client_id, scan_week, platform, total_queries, brand_mentions, sov_score) SELECT client_id, scan_week, platform, COUNT(*) as total_queries, SUM(CASE WHEN brand_mentioned THEN 1 ELSE 0 END) as brand_mentions, ROUND(SUM(CASE WHEN brand_mentioned THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100, 2) as sov_score FROM pulse_metrics WHERE scan_week = CURRENT_DATE - INTERVAL '7 days' GROUP BY client_id, scan_week, platform ON CONFLICT DO NOTHING"
      },
      "name": "Compute Weekly Summary",
      "type": "n8n-nodes-base.postgres",
      "position": [1200, 0]
    }
  ],
  "connections": {
    "Schedule Trigger":    { "main": [[{ "node": "Get Active Prompts",    "type": "main", "index": 0 }]] },
    "Get Active Prompts":  { "main": [[{ "node": "Split In Batches",       "type": "main", "index": 0 }]] },
    "Split In Batches":    { "main": [[{ "node": "Query Perplexity Sonar", "type": "main", "index": 0 }, { "node": "Query GPT-4o", "type": "main", "index": 0 }, { "node": "Query Claude Haiku", "type": "main", "index": 0 }, { "node": "Query Gemini Flash", "type": "main", "index": 0 }]] },
    "Query Perplexity Sonar": { "main": [[{ "node": "Analyse with Claude", "type": "main", "index": 0 }]] },
    "Query GPT-4o":           { "main": [[{ "node": "Analyse with Claude", "type": "main", "index": 0 }]] },
    "Query Claude Haiku":     { "main": [[{ "node": "Analyse with Claude", "type": "main", "index": 0 }]] },
    "Query Gemini Flash":     { "main": [[{ "node": "Analyse with Claude", "type": "main", "index": 0 }]] },
    "Analyse with Claude":  { "main": [[{ "node": "Write pulse_metrics",    "type": "main", "index": 0 }]] },
    "Write pulse_metrics":  { "main": [[{ "node": "Compute Weekly Summary", "type": "main", "index": 0 }]] }
  }
}
```

- [ ] **Step 2: Import workflow into n8n**

In your self-hosted n8n: Workflows → Import from file → select `n8n/ai-pulse-weekly.json`.

Configure credentials:
- Postgres node: point to Supabase connection string (`postgresql://postgres:[SERVICE_ROLE_KEY]@db.ggudkqnxglvydplqmcbh.supabase.co:5432/postgres`)
- HTTP Request nodes: add header `Authorization: Bearer $OPENROUTER_API_KEY`

- [ ] **Step 3: Run pilot manually**

In n8n, click "Execute Workflow" (manual trigger). Verify:
- `pulse_metrics` table gets rows
- `pulse_weekly_summary` table gets rows

- [ ] **Step 4: Commit**
```bash
git add n8n/
git commit -m "feat: add n8n AI Pulse weekly workflow (importable JSON)"
git push
```

---

## Task 21: End-to-End Verification

- [ ] **Step 1: Run full test suite**
```bash
npm test
```
Expected: all tests PASS with 0 failures.

- [ ] **Step 2: Phase 1 production smoke test**

Visit deployed Vercel URL. Submit `https://fimmick.com`. Verify:
- Redirect to `/en/result/[uuid]`
- Score ring shows a number
- 5 check items appear
- "Generate Fix Pack" produces 3 code blocks

- [ ] **Step 3: Phase 1 bilingual test**

Click 中文. Verify all UI labels switch to Chinese. Score and check messages are in Chinese.

- [ ] **Step 4: Phase 2 onboard via curl**
```bash
curl -X POST https://<your-vercel-url>/api/pulse/onboard \
  -H "Content-Type: application/json" \
  -d '{"brandName":"Fimmick","industry":"Digital Marketing Agency","competitors":["Isobar","GroupM HK","Cherrypicks"]}'
```
Expected: `{"clientId":"<uuid>","promptCount":50}`

- [ ] **Step 5: Phase 2 dashboard**

Run n8n workflow manually. Visit `https://<your-vercel-url>/en/pulse/<clientId>`. Verify KPI cards, charts render (even with limited data).

- [ ] **Step 6: Final commit**
```bash
git add -A
git commit -m "chore: verified Phase 1 + Phase 2 end-to-end"
git push
```
