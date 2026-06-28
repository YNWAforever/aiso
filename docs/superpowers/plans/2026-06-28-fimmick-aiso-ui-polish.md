# Fimmick AISO UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish every public, dashboard, Pulse, report, settings, and admin page into one coherent Fimmick AISO operations-console UI without changing product structure or API behavior.

**Architecture:** Build a small shared UI foundation first, then migrate page families onto it. The implementation should preserve the existing Next.js App Router route structure, Supabase data loading, translations, and dashboard step model while replacing hardcoded visual treatments with semantic tokens and reusable status/page/table/form patterns.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Tailwind CSS v4 token CSS, lucide-react, Vitest, Playwright for visual verification.

---

## Required Context Before Code

- Read the approved design spec: `docs/superpowers/specs/2026-06-28-fimmick-aiso-ui-polish-design.md`.
- Before editing route/layout/client-boundary code, read:
  - `node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md`
  - `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
  - `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md`
  - `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`
- Keep unrelated worktree changes untouched:
  - `scripts/mcp-postgres.sh`
  - `__tests__/scripts/`

---

## File Structure

### New Files

- `components/ui/app-logo.tsx`  
  Shared Fimmick AISO lockup for public, dashboard, result, and admin shells.

- `components/ui/page-header.tsx`  
  Reusable page header with title, description, optional eyebrow/meta/action slot.

- `components/ui/status.tsx`  
  Lucide-backed status icon/chip utilities for pass, warn, fail, locked, pro, live, active, inactive.

- `components/ui/empty-state.tsx`  
  Shared icon/title/body/action empty state.

- `components/ui/table-shell.tsx`  
  Shared responsive table wrapper and header/cell class helpers.

- `__tests__/ui/ui-polish.test.tsx`  
  Static and server-rendered regression tests for shared UI primitives and removal of structural emoji/glyph UI.

### Modified Foundation Files

- `app/globals.css`  
  Update tokens, reduced-motion handling, tabular-number helper, and shared focus/touch utility classes.

- `components/ui/button.tsx`  
  Minimum touch target, stronger focus, stable disabled styling.

- `components/ui/input.tsx`  
  44px default height, clearer focus/disabled states.

### Modified Page and Component Families

- Public funnel:
  - `app/[lang]/page.tsx`
  - `app/[lang]/pricing/page.tsx`
  - `app/[lang]/auth/login/page.tsx`
  - `components/auth/LoginForm.tsx`
  - `components/onboarding/OnboardingWizard.tsx`

- Result/report:
  - `components/result/ResultClient.tsx`
  - `components/result/ScoreReveal.tsx`
  - `components/result/TopIssueCard.tsx`
  - `components/result/LockedPreview.tsx`
  - `components/result/ImpactTeaser.tsx`
  - `components/result/ImpactPanel.tsx`
  - `components/result/TrialCta.tsx`
  - `components/ExpandableCheckItem.tsx`
  - `components/CheckItem.tsx`

- Dashboard:
  - `app/[lang]/dashboard/layout.tsx`
  - `app/[lang]/dashboard/page.tsx`
  - `app/[lang]/dashboard/[clientId]/page.tsx`
  - `app/[lang]/dashboard/[clientId]/result/[scanId]/page.tsx`
  - `app/[lang]/dashboard/settings/page.tsx`
  - `components/dashboard/DashboardSidebar.tsx`
  - `components/dashboard/WizardProgress.tsx`
  - `components/dashboard/PlanGate.tsx`
  - `components/dashboard/BrandCard.tsx`
  - `components/dashboard/RecentScans.tsx`
  - `components/dashboard/ScanStep.tsx`
  - `components/dashboard/ResultsStep.tsx`
  - `components/dashboard/ImproveStep.tsx`
  - `components/dashboard/MonitorStep.tsx`
  - `components/dashboard/LockedFeature.tsx`
  - `components/dashboard/TrialBanner.tsx`

- Pulse:
  - `app/[lang]/pulse/[clientId]/page.tsx`
  - `components/pulse/SovChart.tsx`
  - `components/pulse/PlatformBar.tsx`
  - `components/pulse/MissedTable.tsx`
  - `components/pulse/ScanLogSection.tsx`
  - `components/pulse/QuestionBankSection.tsx`
  - `components/pulse/QuestionRow.tsx`
  - `components/pulse/PromptBankEditor.tsx`
  - `components/pulse/SuggestQuestionsPanel.tsx`

- Admin:
  - `app/admin/layout.tsx`
  - `app/admin/page.tsx`
  - `app/[lang]/admin/authority/page.tsx`

- Messages, only where clarity requires removing emoji from rendered UI text:
  - `messages/en.json`
  - `messages/zh-HK.json`

---

## Task 1: Foundation UI Primitives and Regression Tests

**Files:**
- Create: `components/ui/status.tsx`
- Create: `components/ui/app-logo.tsx`
- Create: `components/ui/page-header.tsx`
- Create: `components/ui/empty-state.tsx`
- Create: `components/ui/table-shell.tsx`
- Create: `__tests__/ui/ui-polish.test.tsx`

- [ ] **Step 1: Read required Next.js local docs**

Run:

```bash
sed -n '1,220p' node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md
sed -n '1,220p' node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
sed -n '1,180p' node_modules/next/dist/docs/01-app/01-getting-started/11-css.md
sed -n '1,160p' node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md
```

Expected: Docs render without file-not-found errors. Note that shared server-safe UI components must not use hooks unless marked `'use client'`.

- [ ] **Step 2: Write failing tests for shared status UI and structural glyph cleanup**

Create `__tests__/ui/ui-polish.test.tsx`:

```tsx
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

const uiFilesWithoutStructuralEmoji = [
  'app/[lang]/page.tsx',
  'app/[lang]/pricing/page.tsx',
  'app/[lang]/dashboard/settings/page.tsx',
  'app/[lang]/dashboard/[clientId]/result/[scanId]/page.tsx',
  'app/admin/layout.tsx',
  'components/dashboard/DashboardSidebar.tsx',
  'components/dashboard/WizardProgress.tsx',
  'components/dashboard/PlanGate.tsx',
  'components/ExpandableCheckItem.tsx',
  'components/CheckItem.tsx',
  'components/result/ResultClient.tsx',
]

describe('UI polish primitives', () => {
  it('renders semantic status chips with icons and text', async () => {
    const { StatusChip } = await import('@/components/ui/status')

    const pass = renderToStaticMarkup(<StatusChip tone="pass">Passing</StatusChip>)
    const locked = renderToStaticMarkup(<StatusChip tone="locked">Locked</StatusChip>)

    expect(pass).toContain('Passing')
    expect(pass).toContain('aria-hidden="true"')
    expect(locked).toContain('Locked')
    expect(locked).toContain('data-tone="locked"')
  })

  it('renders the product logo consistently', async () => {
    const { AppLogo } = await import('@/components/ui/app-logo')

    const markup = renderToStaticMarkup(<AppLogo href="/en" productLabel="AISO" />)

    expect(markup).toContain('Fimmick')
    expect(markup).toContain('AISO')
    expect(markup).toContain('href="/en"')
  })

  it('does not use emoji or raw arrow glyphs as structural UI controls', () => {
    const disallowed = ['🔒', '✅', '⚠️', '❌', '▾', '▸', '←', '→']

    for (const file of uiFilesWithoutStructuralEmoji) {
      const source = readFileSync(join(repoRoot, file), 'utf8')
      for (const glyph of disallowed) {
        expect(source, `${file} should not contain ${glyph}`).not.toContain(glyph)
      }
    }
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run:

```bash
npm test -- __tests__/ui/ui-polish.test.tsx
```

Expected: FAIL because `components/ui/status.tsx` and `components/ui/app-logo.tsx` do not exist yet.

- [ ] **Step 4: Create `components/ui/status.tsx`**

Use this complete file:

```tsx
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleDot,
  Lock,
  Radio,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export type StatusTone =
  | 'pass'
  | 'warn'
  | 'fail'
  | 'locked'
  | 'pro'
  | 'live'
  | 'active'
  | 'inactive'

const toneClasses: Record<StatusTone, string> = {
  pass: 'border-success/25 bg-success/10 text-success',
  warn: 'border-warning/30 bg-warning/10 text-warning',
  fail: 'border-destructive/25 bg-destructive/10 text-destructive',
  locked: 'border-border bg-muted text-muted-foreground',
  pro: 'border-warning/30 bg-warning/10 text-warning',
  live: 'border-success/25 bg-success/10 text-success',
  active: 'border-primary/25 bg-primary/10 text-primary',
  inactive: 'border-border bg-muted text-muted-foreground',
}

const icons = {
  pass: CheckCircle2,
  warn: AlertTriangle,
  fail: XCircle,
  locked: Lock,
  pro: ShieldCheck,
  live: Radio,
  active: CircleDot,
  inactive: Circle,
} as const

type StatusIconProps = {
  tone: StatusTone
  className?: string
  label?: string
}

export function StatusIcon({ tone, className, label }: StatusIconProps) {
  const Icon = icons[tone]
  return (
    <Icon
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={cn('size-4 shrink-0', className)}
    />
  )
}

type StatusChipProps = {
  tone: StatusTone
  children: ReactNode
  className?: string
  showIcon?: boolean
}

export function StatusChip({ tone, children, className, showIcon = true }: StatusChipProps) {
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold leading-none',
        toneClasses[tone],
        className
      )}
    >
      {showIcon && <StatusIcon tone={tone} className="size-3.5" />}
      <span>{children}</span>
    </span>
  )
}

export function statusToneForCheck(status: 'pass' | 'warn' | 'fail'): StatusTone {
  return status
}
```

- [ ] **Step 5: Create `components/ui/app-logo.tsx`**

Use this complete file:

```tsx
import Link from 'next/link'
import { Brain } from 'lucide-react'
import { cn } from '@/lib/utils'

type AppLogoProps = {
  href?: string
  productLabel?: string
  className?: string
  markClassName?: string
}

export function AppLogo({
  href,
  productLabel = 'AISO',
  className,
  markClassName,
}: AppLogoProps) {
  const content = (
    <>
      <span
        className={cn(
          'flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm',
          markClassName
        )}
      >
        <Brain className="size-4" aria-hidden="true" />
      </span>
      <span className="font-black tracking-tight text-foreground">
        Fimmick <span className="text-primary">{productLabel}</span>
      </span>
    </>
  )

  const classes = cn('inline-flex min-h-11 items-center gap-2.5 text-sm', className)

  if (href) {
    return (
      <Link href={href} className={classes} aria-label={`Fimmick ${productLabel}`}>
        {content}
      </Link>
    )
  }

  return (
    <div className={classes} aria-label={`Fimmick ${productLabel}`}>
      {content}
    </div>
  )
}
```

- [ ] **Step 6: Create `components/ui/page-header.tsx`**

Use this complete file:

```tsx
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type PageHeaderProps = {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  meta?: ReactNode
  action?: ReactNode
  className?: string
}

export function PageHeader({
  eyebrow,
  title,
  description,
  meta,
  action,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('border-b border-border bg-background/95 px-6 py-5', className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">
              {eyebrow}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-black leading-tight text-foreground">{title}</h1>
            {meta}
          </div>
          {description && (
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </header>
  )
}
```

- [ ] **Step 7: Create `components/ui/empty-state.tsx`**

Use this complete file:

```tsx
import type { ComponentType, ReactNode } from 'react'
import type { LucideProps } from 'lucide-react'
import { cn } from '@/lib/utils'

type EmptyStateProps = {
  icon: ComponentType<LucideProps>
  title: ReactNode
  body: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, body, action, className }: EmptyStateProps) {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-8 text-center', className)}>
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <h2 className="text-base font-bold text-card-foreground">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
```

- [ ] **Step 8: Create `components/ui/table-shell.tsx`**

Use this complete file:

```tsx
import type { HTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function TableShell({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'overflow-x-auto rounded-lg border border-border bg-card shadow-sm',
        className
      )}
      {...props}
    />
  )
}

export function tableHeaderClass(className?: string) {
  return cn('bg-muted/60 text-left text-xs font-semibold text-muted-foreground', className)
}

export function tableHeadCellClass(className?: string) {
  return cn('px-4 py-3 align-middle font-semibold', className)
}

export function tableRowClass(className?: string) {
  return cn('border-b border-border last:border-0 hover:bg-muted/40', className)
}

export function tableCellClass(className?: string) {
  return cn('px-4 py-3 align-middle text-sm text-foreground', className)
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={tableHeadCellClass(className)} {...props} />
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={tableCellClass(className)} {...props} />
}
```

- [ ] **Step 9: Run foundation tests**

Run:

```bash
npm test -- __tests__/ui/ui-polish.test.tsx
```

Expected: The first two tests PASS. The structural glyph test still FAILS until later tasks replace existing glyphs.

- [ ] **Step 10: Commit foundation primitives**

Run:

```bash
git add components/ui/status.tsx components/ui/app-logo.tsx components/ui/page-header.tsx components/ui/empty-state.tsx components/ui/table-shell.tsx __tests__/ui/ui-polish.test.tsx
git commit -m "feat(ui): add shared polish primitives"
```

Expected: Commit includes only the new shared UI files and test file.

---

## Task 2: Global Tokens, Touch Targets, and Reduced Motion

**Files:**
- Modify: `app/globals.css`
- Modify: `components/ui/button.tsx`
- Modify: `components/ui/input.tsx`
- Test: `__tests__/ui/ui-polish.test.tsx`

- [ ] **Step 1: Extend tests for global CSS requirements**

Append this test inside `describe('UI polish primitives', ...)` in `__tests__/ui/ui-polish.test.tsx`:

```tsx
  it('defines motion and numeric helpers in global CSS', () => {
    const css = readFileSync(join(repoRoot, 'app/globals.css'), 'utf8')

    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('.tabular-nums')
    expect(css).toContain('--dash-attention')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- __tests__/ui/ui-polish.test.tsx
```

Expected: FAIL because `--dash-attention`, `.tabular-nums`, or reduced-motion support is missing.

- [ ] **Step 3: Update `app/globals.css` tokens and utilities**

In `:root`, add this dashboard token near the existing dashboard tokens:

```css
  --dash-attention: #b45309;
```

In `.dark`, add:

```css
  --dash-attention: #fbbf24;
```

Inside `@theme inline`, add:

```css
  --color-dash-attention: var(--dash-attention);
```

At the end of the file, add:

```css
.tabular-nums {
  font-variant-numeric: tabular-nums;
}

.touch-target {
  min-height: 44px;
  min-width: 44px;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 4: Update default `Button` sizing**

In `components/ui/button.tsx`, change the base variant string from:

```tsx
'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0'
```

to:

```tsx
'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0'
```

Then change sizes:

```tsx
default: 'h-11 px-4 py-2',
sm:      'h-9 rounded-md px-3 text-xs',
lg:      'h-12 px-6 text-base',
icon:    'h-11 w-11 p-0',
```

- [ ] **Step 5: Update default `Input` height**

In `components/ui/input.tsx`, change:

```tsx
'flex h-9 w-full rounded-lg border border-border bg-input px-3 py-1 text-sm text-foreground shadow-sm transition-colors',
```

to:

```tsx
'flex h-11 w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground shadow-sm transition-colors',
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- __tests__/ui/ui-polish.test.tsx
```

Expected: CSS helper test PASS. Structural glyph test may still FAIL.

- [ ] **Step 7: Commit token and primitive updates**

Run:

```bash
git add app/globals.css components/ui/button.tsx components/ui/input.tsx __tests__/ui/ui-polish.test.tsx
git commit -m "feat(ui): tighten tokens and touch targets"
```

Expected: Commit contains only global CSS, button/input, and the updated UI test.

---

## Task 3: Replace Structural Emoji and Glyph Controls

**Files:**
- Modify: `components/ExpandableCheckItem.tsx`
- Modify: `components/CheckItem.tsx`
- Modify: `components/result/ResultClient.tsx`
- Modify: `components/dashboard/DashboardSidebar.tsx`
- Modify: `components/dashboard/WizardProgress.tsx`
- Modify: `components/dashboard/PlanGate.tsx`
- Modify: `app/[lang]/page.tsx`
- Modify: `app/[lang]/dashboard/settings/page.tsx`
- Modify: `app/[lang]/dashboard/[clientId]/result/[scanId]/page.tsx`
- Modify: `app/admin/layout.tsx`
- Test: `__tests__/ui/ui-polish.test.tsx`

- [ ] **Step 1: Run existing structural-glyph test**

Run:

```bash
npm test -- __tests__/ui/ui-polish.test.tsx
```

Expected: FAIL and list files containing `🔒`, `✅`, `⚠️`, `❌`, `▾`, `▸`, `←`, or `→`.

- [ ] **Step 2: Replace check item emoji with status icons**

In `components/CheckItem.tsx`, replace the whole file with:

```tsx
import type { CheckResult } from '@/lib/types'
import { StatusIcon, statusToneForCheck } from '@/components/ui/status'

const COLORS = {
  pass: 'text-success',
  warn: 'text-warning',
  fail: 'text-destructive',
}

interface Props {
  label: string
  result: CheckResult
  message: string
}

export function CheckItem({ label, result, message }: Props) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2.5 last:border-0">
      <span className="min-w-0 text-sm text-foreground">{label}</span>
      <div className="flex shrink-0 items-center gap-2">
        <span className={`text-sm font-medium ${COLORS[result.status]}`}>{message}</span>
        <StatusIcon tone={statusToneForCheck(result.status)} className={COLORS[result.status]} />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Replace expandable check item emoji and custom SVG chevron**

In `components/ExpandableCheckItem.tsx`:

Add imports:

```tsx
import { ChevronDown } from 'lucide-react'
import { StatusIcon, statusToneForCheck } from '@/components/ui/status'
```

Delete `STATUS_ICON`. Replace `STATUS_COLOR` values with:

```tsx
const STATUS_COLOR = {
  pass: 'text-success',
  warn: 'text-warning',
  fail: 'text-destructive',
} as const
```

Replace the status icon row span:

```tsx
<span className="shrink-0">{STATUS_ICON[result.status]}</span>
```

with:

```tsx
<StatusIcon tone={statusToneForCheck(result.status)} className={STATUS_COLOR[result.status]} />
```

Replace the inline `<svg>` chevron with:

```tsx
<ChevronDown
  className={`size-4 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
  aria-hidden="true"
/>
```

Update hardcoded `slate` classes in this component to semantic tokens:

```tsx
border-slate-100 -> border-border
hover:bg-slate-50 -> hover:bg-muted/50
text-slate-700 -> text-foreground
text-slate-500 -> text-muted-foreground
text-slate-400 -> text-muted-foreground
```

- [ ] **Step 4: Replace status emoji in `components/result/ResultClient.tsx`**

Add import:

```tsx
import { ArrowLeft } from 'lucide-react'
import { StatusChip } from '@/components/ui/status'
```

Change copy values:

```tsx
scanAnother: 'Scan another URL',
```

and:

```tsx
scanAnother: '掃描另一個網址',
```

Replace the status summary spans:

```tsx
{pass > 0 && <span className="bg-emerald-100 text-emerald-700 font-semibold px-2.5 py-1 rounded-full">✅ {ui.passing(pass)}</span>}
{warn > 0 && <span className="bg-amber-100  text-amber-700  font-semibold px-2.5 py-1 rounded-full">⚠️ {ui.warnings(warn)}</span>}
{fail > 0 && <span className="bg-red-100    text-red-700    font-semibold px-2.5 py-1 rounded-full">❌ {ui.failing(fail)}</span>}
```

with:

```tsx
{pass > 0 && <StatusChip tone="pass">{ui.passing(pass)}</StatusChip>}
{warn > 0 && <StatusChip tone="warn">{ui.warnings(warn)}</StatusChip>}
{fail > 0 && <StatusChip tone="fail">{ui.failing(fail)}</StatusChip>}
```

Replace the scan-another link content with:

```tsx
<ArrowLeft className="size-4" aria-hidden="true" />
{ui.scanAnother}
```

and use classes:

```tsx
className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
```

- [ ] **Step 5: Replace sidebar lock emoji**

In `components/dashboard/DashboardSidebar.tsx`, add `Lock` to the lucide import. Replace:

```tsx
{locked && <span className="text-[9px] ml-auto">🔒</span>}
```

with:

```tsx
{locked && <Lock className="ml-auto size-3.5" aria-label={t('locked')} />}
```

If `dashboard.locked` is missing from both message files, add:

```json
"locked": "Locked"
```

and:

```json
"locked": "已鎖定"
```

- [ ] **Step 6: Replace wizard progress glyphs**

In `components/dashboard/WizardProgress.tsx`, import:

```tsx
import { Check, Lock } from 'lucide-react'
```

Replace:

```tsx
{isCompleted ? '✓' : isLocked ? '🔒' : i + 1}
```

with:

```tsx
{isCompleted ? (
  <Check className="size-3.5" aria-hidden="true" />
) : isLocked ? (
  <Lock className="size-3.5" aria-label={access.reason ?? 'Locked'} />
) : (
  i + 1
)}
```

- [ ] **Step 7: Replace plan gate lock and arrow glyph**

In `components/dashboard/PlanGate.tsx`, import:

```tsx
import { ArrowRight, Lock } from 'lucide-react'
```

Replace the lock `<div>` with:

```tsx
<div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-warning/10 text-warning">
  <Lock className="size-5" aria-hidden="true" />
</div>
```

Replace `Upgrade to Pro →` with:

```tsx
Upgrade to Pro <ArrowRight className="size-4" aria-hidden="true" />
```

and add `inline-flex items-center gap-2` to the link class.

- [ ] **Step 8: Replace homepage disclosure glyphs**

In `app/[lang]/page.tsx`, add `ChevronDown` to the existing lucide import. Replace:

```tsx
<span className="text-[10px]">{showPersonalise ? '▾' : '▸'}</span>
```

with:

```tsx
<ChevronDown
  className={`size-3.5 transition-transform ${showPersonalise ? 'rotate-180' : '-rotate-90'}`}
  aria-hidden="true"
/>
```

- [ ] **Step 9: Replace settings and admin arrow glyphs**

In `app/[lang]/dashboard/settings/page.tsx`, import `ArrowRight` from `lucide-react`.

Change link text:

```tsx
Manage Billing →
Upgrade to Pro →
Upgrade to Enterprise →
```

to text plus `<ArrowRight className="size-4" aria-hidden="true" />`, and ensure each link includes:

```tsx
inline-flex min-h-11 items-center gap-2
```

In `app/admin/layout.tsx`, import `ArrowLeft`. Replace `← Back to Dashboard` with:

```tsx
<ArrowLeft className="size-4" aria-hidden="true" />
Back to Dashboard
```

and add `inline-flex min-h-11 items-center gap-2`.

- [ ] **Step 10: Replace nested dashboard result back glyphs**

In `app/[lang]/dashboard/[clientId]/result/[scanId]/page.tsx`, import `ArrowLeft` if not already present. Replace both occurrences of `← Back to Results` with:

```tsx
<ArrowLeft className="size-4" aria-hidden="true" />
Back to Results
```

Make the containing link `inline-flex min-h-11 items-center gap-2`.

- [ ] **Step 11: Run structural-glyph test**

Run:

```bash
npm test -- __tests__/ui/ui-polish.test.tsx
```

Expected: all tests in `__tests__/ui/ui-polish.test.tsx` PASS.

- [ ] **Step 12: Commit structural glyph cleanup**

Run:

```bash
git add components/ExpandableCheckItem.tsx components/CheckItem.tsx components/result/ResultClient.tsx components/dashboard/DashboardSidebar.tsx components/dashboard/WizardProgress.tsx components/dashboard/PlanGate.tsx app/[lang]/page.tsx app/[lang]/dashboard/settings/page.tsx app/[lang]/dashboard/[clientId]/result/[scanId]/page.tsx app/admin/layout.tsx messages/en.json messages/zh-HK.json
git commit -m "feat(ui): replace glyph controls with semantic icons"
```

Expected: Commit excludes unrelated MCP files.

---

## Task 4: Public Funnel Polish

**Files:**
- Modify: `app/[lang]/page.tsx`
- Modify: `app/[lang]/pricing/page.tsx`
- Modify: `app/[lang]/auth/login/page.tsx`
- Modify: `components/auth/LoginForm.tsx`
- Modify: `components/onboarding/OnboardingWizard.tsx`
- Test: `__tests__/ui/ui-polish.test.tsx`

- [ ] **Step 1: Add static tests for public funnel shared primitives**

Append this test:

```tsx
  it('uses shared logo and accessible public-page controls', () => {
    const home = readFileSync(join(repoRoot, 'app/[lang]/page.tsx'), 'utf8')
    const pricing = readFileSync(join(repoRoot, 'app/[lang]/pricing/page.tsx'), 'utf8')
    const login = readFileSync(join(repoRoot, 'app/[lang]/auth/login/page.tsx'), 'utf8')

    expect(home).toContain('AppLogo')
    expect(pricing).toContain('AppLogo')
    expect(login).toContain('AppLogo')
    expect(pricing).toContain('aria-pressed')
    expect(pricing).toContain('checkoutError')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- __tests__/ui/ui-polish.test.tsx
```

Expected: FAIL because public pages still use hand-rolled logos and pricing toggle lacks `aria-pressed`.

- [ ] **Step 3: Replace public-page logo blocks**

In `app/[lang]/page.tsx`, `app/[lang]/pricing/page.tsx`, and `app/[lang]/auth/login/page.tsx`:

Add:

```tsx
import { AppLogo } from '@/components/ui/app-logo'
```

Replace hand-rolled logo markup with:

```tsx
<AppLogo href={`/${params.lang}`} />
```

for homepage nav, with:

```tsx
<AppLogo href={`/${lang}`} productLabel={t('nav_brand')} />
```

for pricing, and with:

```tsx
<AppLogo productLabel="AISO" className="justify-center" />
```

for login.

- [ ] **Step 4: Tighten homepage surfaces**

In `app/[lang]/page.tsx`, update repeated light-only surfaces:

```tsx
bg-white -> bg-card
text-slate-100 -> text-muted
stroke-slate-100 -> stroke-muted
bg-slate-100 -> bg-muted
from-slate-50 to-white -> from-muted/50 to-background
```

Keep platform dot inline colors for brand identity, but wrap platform labels in tokenized chips:

```tsx
className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground/80"
```

- [ ] **Step 5: Make homepage scan form more accessible**

In the homepage scan input, add:

```tsx
aria-label={t('home.placeholder')}
```

In both scan submit buttons, add:

```tsx
aria-busy={loading}
```

and ensure the loading state stays disabled:

```tsx
disabled={loading}
```

- [ ] **Step 6: Fix pricing toggle semantics**

In `app/[lang]/pricing/page.tsx`, update the monthly/annual toggle button:

```tsx
<button
  type="button"
  onClick={() => setAnnual(v => !v)}
  aria-pressed={annual}
  aria-label={annual ? t('toggle_annual') : t('toggle_monthly')}
  className={`relative inline-flex h-7 w-12 items-center rounded-full shadow-inner transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${annual ? 'bg-primary' : 'bg-muted'}`}
>
```

Update the knob:

```tsx
<span className={`inline-block size-5 rounded-full bg-white shadow-md transition-transform ${annual ? 'translate-x-6' : 'translate-x-1'}`} />
```

- [ ] **Step 7: Move checkout error near all pricing actions**

In `app/[lang]/pricing/page.tsx`, add below the annual toggle:

```tsx
{checkoutError && (
  <p className="mt-4 text-sm font-medium text-destructive" role="alert">
    {checkoutError}
  </p>
)}
```

Remove the Pro-card-only checkout error block:

```tsx
{plan.key === 'pro' && checkoutError && (...)}
```

- [ ] **Step 8: Remove Pro card scale distortion**

In pricing plan card classes, replace:

```tsx
'border-2 border-primary bg-white shadow-2xl shadow-primary/15 scale-[1.02]'
```

with:

```tsx
'border-2 border-primary bg-card shadow-xl shadow-primary/10'
```

Replace non-Pro card:

```tsx
'border border-border bg-white shadow-sm hover:shadow-md'
```

with:

```tsx
'border border-border bg-card shadow-sm hover:border-primary/30 hover:shadow-md'
```

- [ ] **Step 9: Improve login form labels**

In `components/auth/LoginForm.tsx`, wrap the email input with a visible label:

```tsx
<label className="block text-sm font-medium text-foreground">
  Email
  <Input
    type="email"
    value={email}
    onChange={e => setEmail(e.target.value)}
    placeholder={c.emailPlaceholder}
    autoComplete="email"
    required
    className="mt-1"
  />
</label>
```

For Chinese, if a localized label is needed, add `emailLabel` to both copy maps:

```tsx
emailLabel: 'Email',
```

and:

```tsx
emailLabel: '電郵',
```

Then use `{c.emailLabel}`.

- [ ] **Step 10: Make onboarding progress and inputs consistent**

In `components/onboarding/OnboardingWizard.tsx`, replace local `inputClass`, `btnPrimary`, and `btnBack` string use with `Input` and `Button` imports where practical:

```tsx
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
```

For each text input, use:

```tsx
<Input ... className="mb-6" />
```

For primary buttons, use:

```tsx
<Button type="button" onClick={() => setStep(2)} disabled={!brand.trim()} className="w-full">
  {c.continue} <ChevronRight className="size-4" aria-hidden="true" />
</Button>
```

Keep selects as native `<select>` but apply:

```tsx
className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
```

- [ ] **Step 11: Run focused tests**

Run:

```bash
npm test -- __tests__/ui/ui-polish.test.tsx
```

Expected: PASS.

- [ ] **Step 12: Commit public funnel polish**

Run:

```bash
git add app/[lang]/page.tsx app/[lang]/pricing/page.tsx app/[lang]/auth/login/page.tsx components/auth/LoginForm.tsx components/onboarding/OnboardingWizard.tsx __tests__/ui/ui-polish.test.tsx messages/en.json messages/zh-HK.json
git commit -m "feat(ui): polish public funnel"
```

Expected: Commit contains only public funnel changes and related test/message updates.

---

## Task 5: Result Report and Dossier Components

**Files:**
- Modify: `components/result/ResultClient.tsx`
- Modify: `components/result/ScoreReveal.tsx`
- Modify: `components/result/TopIssueCard.tsx`
- Modify: `components/result/LockedPreview.tsx`
- Modify: `components/result/ImpactTeaser.tsx`
- Modify: `components/result/ImpactPanel.tsx`
- Modify: `components/result/TrialCta.tsx`
- Modify: `components/ExpandableCheckItem.tsx`
- Test: `__tests__/ui/ui-polish.test.tsx`

- [ ] **Step 1: Add static report tests**

Append:

```tsx
  it('uses dossier primitives on result surfaces', () => {
    const resultClient = readFileSync(join(repoRoot, 'components/result/ResultClient.tsx'), 'utf8')
    const expandable = readFileSync(join(repoRoot, 'components/ExpandableCheckItem.tsx'), 'utf8')

    expect(resultClient).toContain('StatusChip')
    expect(resultClient).toContain('AppLogo')
    expect(expandable).toContain('StatusIcon')
    expect(resultClient).not.toContain('bg-slate-50')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- __tests__/ui/ui-polish.test.tsx
```

Expected: FAIL because `ResultClient` has not fully moved to `AppLogo` and semantic background tokens.

- [ ] **Step 3: Update `ResultClient` shell and nav**

In `components/result/ResultClient.tsx`, import:

```tsx
import { AppLogo } from '@/components/ui/app-logo'
```

Replace outer shell:

```tsx
<div className="min-h-screen bg-slate-50">
```

with:

```tsx
<div className="min-h-screen bg-background">
```

Replace nav logo block with:

```tsx
<AppLogo href={`/${lang}`} />
```

Update nav class:

```tsx
className="sticky top-0 z-50 flex items-center justify-between border-b border-border bg-card/95 px-6 py-3 backdrop-blur"
```

Update main container:

```tsx
<main className="mx-auto max-w-3xl space-y-5 px-4 py-8 sm:px-6 sm:py-10">
```

- [ ] **Step 4: Tokenize check section**

In `CheckSection` inside `ResultClient`, replace:

```tsx
<div className="bg-white rounded-2xl border border-slate-200 p-6">
```

with:

```tsx
<div className="rounded-lg border border-border bg-card p-5 shadow-sm">
```

Replace title/subtitle classes:

```tsx
text-slate-500 -> text-muted-foreground
text-slate-400 -> text-muted-foreground
```

- [ ] **Step 5: Tokenize result child components**

For each result component listed in this task, replace hardcoded slate/white status surface classes with semantic tokens:

```tsx
bg-white -> bg-card
bg-slate-50 -> bg-background
border-slate-200 -> border-border
border-slate-100 -> border-border
text-slate-900 -> text-foreground
text-slate-800 -> text-foreground
text-slate-700 -> text-foreground
text-slate-600 -> text-muted-foreground
text-slate-500 -> text-muted-foreground
text-slate-400 -> text-muted-foreground
```

Keep status-specific colors only when paired with text or `StatusChip`.

- [ ] **Step 6: Ensure email capture and CTA buttons use shared button classes**

In `EmailCaptureGate` if it uses raw button classes, keep behavior but align with `Button` from `components/ui/button`. If the component already uses `Button`, only update spacing and focus classes.

- [ ] **Step 7: Run report tests**

Run:

```bash
npm test -- __tests__/ui/ui-polish.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit result report polish**

Run:

```bash
git add components/result/ResultClient.tsx components/result/ScoreReveal.tsx components/result/TopIssueCard.tsx components/result/LockedPreview.tsx components/result/ImpactTeaser.tsx components/result/ImpactPanel.tsx components/result/TrialCta.tsx components/ExpandableCheckItem.tsx __tests__/ui/ui-polish.test.tsx
git commit -m "feat(ui): polish result dossier"
```

Expected: Commit contains only result/report UI changes and tests.

---

## Task 6: Dashboard Shell, Home, Settings, and Workflow Polish

**Files:**
- Modify: `app/[lang]/dashboard/layout.tsx`
- Modify: `app/[lang]/dashboard/page.tsx`
- Modify: `app/[lang]/dashboard/[clientId]/page.tsx`
- Modify: `app/[lang]/dashboard/settings/page.tsx`
- Modify: dashboard components listed in File Structure
- Test: `__tests__/ui/ui-polish.test.tsx`

- [ ] **Step 1: Add dashboard static tests**

Append:

```tsx
  it('uses shared dashboard header and tokenized sidebar surfaces', () => {
    const dashboardHome = readFileSync(join(repoRoot, 'app/[lang]/dashboard/page.tsx'), 'utf8')
    const clientPage = readFileSync(join(repoRoot, 'app/[lang]/dashboard/[clientId]/page.tsx'), 'utf8')
    const sidebar = readFileSync(join(repoRoot, 'components/dashboard/DashboardSidebar.tsx'), 'utf8')

    expect(dashboardHome).toContain('PageHeader')
    expect(clientPage).toContain('PageHeader')
    expect(sidebar).toContain('bg-sidebar-background')
    expect(sidebar).not.toContain('bg-white')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- __tests__/ui/ui-polish.test.tsx
```

Expected: FAIL because dashboard pages still use local header markup and sidebar uses `bg-white`.

- [ ] **Step 3: Update dashboard sidebar tokens**

In `components/dashboard/DashboardSidebar.tsx`:

Replace aside class with:

```tsx
className="hidden min-h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar-background text-sidebar-foreground lg:flex"
```

Update inactive nav classes:

```tsx
'text-sidebar-muted-fg hover:bg-sidebar-accent hover:text-sidebar-accent-fg'
```

Update active classes:

```tsx
'bg-sidebar-primary text-sidebar-primary-fg shadow-sm'
```

Replace light-only brand/plan surfaces:

```tsx
bg-primary/5 border-primary/10 -> bg-sidebar-accent border-sidebar-border
from-primary/5 to-blue-50 -> bg-sidebar-accent
```

- [ ] **Step 4: Add mobile dashboard top bar**

In `app/[lang]/dashboard/layout.tsx`, inside the flex content area before children, add a small-screen top bar:

```tsx
<div className="flex items-center justify-between border-b border-border bg-card px-4 py-3 lg:hidden">
  <span className="text-sm font-black text-foreground">Fimmick <span className="text-primary">AISO</span></span>
  <span className="text-xs font-medium text-muted-foreground">{profile.display_name ?? 'User'}</span>
</div>
```

Keep `DashboardSidebar` present for desktop.

- [ ] **Step 5: Use `PageHeader` on dashboard home**

In `app/[lang]/dashboard/page.tsx`, import:

```tsx
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
```

Replace the current header `<div className="pt-6...">` with:

```tsx
<PageHeader
  title={t('my_brands')}
  description={t('brands_intro')}
/>
```

Replace empty state container with:

```tsx
<EmptyState
  icon={Search}
  title={t('add_first_brand')}
  body={t('add_first_brand_body')}
  action={<AddBrandWizard lang={lang} />}
/>
```

- [ ] **Step 6: Use `PageHeader` on client workflow page**

In `app/[lang]/dashboard/[clientId]/page.tsx`, import `PageHeader` and replace `StepHeader` return with:

```tsx
return (
  <PageHeader
    title={i.title}
    description={i.body}
    className="bg-background"
  />
)
```

Delete the old wrapper classes inside `StepHeader`.

- [ ] **Step 7: Use `PageHeader` on settings**

In `app/[lang]/dashboard/settings/page.tsx`, import `PageHeader` and replace the header block with:

```tsx
<PageHeader
  title="Settings"
  description="Manage your subscription plan and billing."
/>
```

Keep settings copy as English because the existing page is already English-only.

- [ ] **Step 8: Tokenize dashboard content cards**

In the dashboard components listed in this task, replace repeated hardcoded slate/white classes with semantic equivalents:

```tsx
bg-white -> bg-card
bg-slate-50 -> bg-background
border-slate-200 -> border-border
border-slate-100 -> border-border
text-slate-900 -> text-foreground
text-slate-700 -> text-foreground
text-slate-500 -> text-muted-foreground
text-slate-400 -> text-muted-foreground
```

Do not change chart series colors or platform brand colors in this task.

- [ ] **Step 9: Run dashboard tests**

Run:

```bash
npm test -- __tests__/ui/ui-polish.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit dashboard polish**

Run:

```bash
git add app/[lang]/dashboard/layout.tsx app/[lang]/dashboard/page.tsx app/[lang]/dashboard/[clientId]/page.tsx app/[lang]/dashboard/settings/page.tsx components/dashboard
git commit -m "feat(ui): polish dashboard shell"
```

Expected: Commit contains dashboard UI changes only.

---

## Task 7: Pulse Analytics Polish

**Files:**
- Modify: `app/[lang]/pulse/[clientId]/page.tsx`
- Modify: `components/pulse/SovChart.tsx`
- Modify: `components/pulse/PlatformBar.tsx`
- Modify: `components/pulse/MissedTable.tsx`
- Modify: `components/pulse/ScanLogSection.tsx`
- Modify: `components/pulse/QuestionBankSection.tsx`
- Modify: `components/pulse/QuestionRow.tsx`
- Modify: `components/pulse/PromptBankEditor.tsx`
- Modify: `components/pulse/SuggestQuestionsPanel.tsx`
- Test: `__tests__/ui/ui-polish.test.tsx`

- [ ] **Step 1: Add Pulse static tests**

Append:

```tsx
  it('uses shared table and page patterns on Pulse surfaces', () => {
    const pulsePage = readFileSync(join(repoRoot, 'app/[lang]/pulse/[clientId]/page.tsx'), 'utf8')
    const missedTable = readFileSync(join(repoRoot, 'components/pulse/MissedTable.tsx'), 'utf8')
    const sovChart = readFileSync(join(repoRoot, 'components/pulse/SovChart.tsx'), 'utf8')

    expect(pulsePage).toContain('PageHeader')
    expect(missedTable).toContain('TableShell')
    expect(sovChart).toContain('aria-label')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- __tests__/ui/ui-polish.test.tsx
```

Expected: FAIL because Pulse does not yet use shared page/table/chart accessibility patterns.

- [ ] **Step 3: Update Pulse page header**

In `app/[lang]/pulse/[clientId]/page.tsx`, import:

```tsx
import { PageHeader } from '@/components/ui/page-header'
import { StatusChip } from '@/components/ui/status'
```

Replace the `<nav>` with a tokenized sticky header:

```tsx
<nav className="sticky top-0 z-30 border-b border-border bg-card/95 px-6 py-3 backdrop-blur">
  <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
    <span className="font-bold text-foreground">
      Fimmick <span className="text-primary">{t('title')}</span>
      <span className="ml-2 text-sm font-normal text-muted-foreground">{clientData.brand_name}</span>
    </span>
    <div className="flex items-center gap-4">
      <a href="#overview" className="hidden min-h-11 items-center text-xs font-medium text-muted-foreground transition hover:text-foreground sm:inline-flex">{t('nav_overview')}</a>
      <a href="#scan-log" className="hidden min-h-11 items-center text-xs font-medium text-muted-foreground transition hover:text-foreground sm:inline-flex">{t('nav_scan_log')}</a>
      <a href="#question-bank" className="hidden min-h-11 items-center text-xs font-medium text-muted-foreground transition hover:text-foreground sm:inline-flex">{t('nav_questions')}</a>
      <StatusChip tone={kpi?.scan_week ? 'live' : 'inactive'} showIcon={Boolean(kpi?.scan_week)}>
        {kpi?.scan_week ? t('week_of', { week: kpi.scan_week }) : t('no_data')}
      </StatusChip>
    </div>
  </div>
</nav>
```

Then add at top of main:

```tsx
<PageHeader
  title={clientData.brand_name}
  description={clientData.industry ? `${t('title')} · ${clientData.industry}` : t('title')}
  className="rounded-lg border border-border bg-card"
/>
```

- [ ] **Step 4: Tokenize Pulse page cards**

Replace:

```tsx
<div className="min-h-screen bg-slate-50">
<main className="max-w-3xl mx-auto px-6 py-10 space-y-10">
```

with:

```tsx
<div className="min-h-screen bg-background">
<main className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
```

Replace card classes:

```tsx
bg-white rounded-xl border border-slate-200 p-6
```

with:

```tsx
rounded-lg border border-border bg-card p-5 shadow-sm
```

- [ ] **Step 5: Add accessible chart wrapper to `SovChart`**

In `components/pulse/SovChart.tsx`, wrap `ResponsiveContainer`:

```tsx
<div
  role="img"
  aria-label="Share of voice trend over time from 0 to 100 percent"
  className="h-44 w-full"
>
  <ResponsiveContainer width="100%" height="100%">
    ...
  </ResponsiveContainer>
</div>
```

Update line stroke to use a CSS variable:

```tsx
<Line type="monotone" dataKey="sov" stroke="var(--primary)" strokeWidth={2.5} dot={false} />
```

- [ ] **Step 6: Use shared table shell in `MissedTable`**

Import:

```tsx
import { TableShell, Th, Td, tableHeaderClass, tableRowClass } from '@/components/ui/table-shell'
```

Replace wrapper:

```tsx
<div className="overflow-x-auto">
```

with:

```tsx
<TableShell>
```

Replace `</div>` with `</TableShell>`.

Replace `thead`:

```tsx
<thead className={tableHeaderClass()}>
```

Replace row classes with `className={tableRowClass()}` and cells with `<Td>` / `<Th>`.

- [ ] **Step 7: Tokenize remaining Pulse components**

Apply the same semantic replacements from Task 6 to all Pulse components. Keep platform brand colors, but make text/background/border tokenized.

- [ ] **Step 8: Run Pulse tests**

Run:

```bash
npm test -- __tests__/ui/ui-polish.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit Pulse polish**

Run:

```bash
git add app/[lang]/pulse/[clientId]/page.tsx components/pulse __tests__/ui/ui-polish.test.tsx
git commit -m "feat(ui): polish pulse analytics"
```

Expected: Commit contains Pulse UI changes and test update.

---

## Task 8: Admin Polish

**Files:**
- Modify: `app/admin/layout.tsx`
- Modify: `app/admin/page.tsx`
- Modify: `app/[lang]/admin/authority/page.tsx`
- Test: `__tests__/ui/ui-polish.test.tsx`

- [ ] **Step 1: Add admin static tests**

Append:

```tsx
  it('uses shared admin table and tokenized admin shell', () => {
    const adminLayout = readFileSync(join(repoRoot, 'app/admin/layout.tsx'), 'utf8')
    const adminPage = readFileSync(join(repoRoot, 'app/admin/page.tsx'), 'utf8')
    const authority = readFileSync(join(repoRoot, 'app/[lang]/admin/authority/page.tsx'), 'utf8')

    expect(adminLayout).toContain('AppLogo')
    expect(adminPage).toContain('TableShell')
    expect(authority).toContain('TableShell')
    expect(adminPage).not.toContain('bg-white')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- __tests__/ui/ui-polish.test.tsx
```

Expected: FAIL because admin files are not using shared components yet.

- [ ] **Step 3: Update admin layout**

In `app/admin/layout.tsx`, import:

```tsx
import { ArrowLeft } from 'lucide-react'
import { AppLogo } from '@/components/ui/app-logo'
```

Replace the nav with:

```tsx
<nav className="border-b border-border bg-card px-6 py-3">
  <div className="mx-auto flex max-w-6xl items-center gap-4">
    <AppLogo productLabel="AISO" />
    <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">
      Admin
    </span>
    <a
      href="/en/dashboard"
      className="ml-auto inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Back to Dashboard
    </a>
  </div>
</nav>
```

Replace outer shell:

```tsx
<div className="min-h-screen bg-background">
```

- [ ] **Step 4: Update `/admin` table**

In `app/admin/page.tsx`, import:

```tsx
import { TableShell, Th, Td, tableHeaderClass, tableRowClass } from '@/components/ui/table-shell'
import { StatusChip } from '@/components/ui/status'
```

Replace loading state:

```tsx
if (loading) return <p className="text-muted-foreground">Loading...</p>
```

Replace table wrapper with `<TableShell>`.

Replace `thead` with:

```tsx
<thead className={tableHeaderClass()}>
```

Replace header cells with `<Th>`.

Replace rows with:

```tsx
<tr key={a.id} className={tableRowClass()}>
```

Use `<Td>` for all cells.

Replace status span with:

```tsx
<StatusChip tone={a.status === 'active' ? 'active' : 'fail'}>{a.status}</StatusChip>
```

Update select class:

```tsx
className="h-9 rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
```

- [ ] **Step 5: Update authority admin table**

In `app/[lang]/admin/authority/page.tsx`, import `PageHeader`, `TableShell`, `Th`, `Td`, `tableHeaderClass`, `tableRowClass`, and `StatusChip`.

Replace page wrapper with:

```tsx
<div className="mx-auto max-w-5xl p-6">
  <PageHeader
    title="Authority Engine"
    description="Manual overrides for trusted, blacklisted, and adjusted authority domains."
    className="mb-6 rounded-lg border border-border bg-card"
  />
  <TableShell>
    ...
  </TableShell>
</div>
```

Map `override_tier` to status chip:

```tsx
const tone = o.override_tier === 'tier1'
  ? 'pass'
  : o.override_tier === 'blacklist'
    ? 'fail'
    : 'inactive'
```

Render:

```tsx
<StatusChip tone={tone}>{o.override_tier as string}</StatusChip>
```

- [ ] **Step 6: Run admin tests**

Run:

```bash
npm test -- __tests__/ui/ui-polish.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit admin polish**

Run:

```bash
git add app/admin/layout.tsx app/admin/page.tsx app/[lang]/admin/authority/page.tsx __tests__/ui/ui-polish.test.tsx
git commit -m "feat(ui): polish admin surfaces"
```

Expected: Commit contains admin UI changes and tests.

---

## Task 9: Build, Visual Verification, and Final Cleanup

**Files:**
- Modify only files needed to fix verification failures.
- Do not touch unrelated MCP launcher files unless the user explicitly folds them into this work.

- [ ] **Step 1: Run full unit tests**

Run:

```bash
npm test
```

Expected: all Vitest tests PASS.

- [ ] **Step 2: Run lint and record current status**

Run:

```bash
npm run lint
```

Expected: Either PASS, or fail with the known pre-existing ESLint/tooling issue involving `.opencode/plugins/superpowers.js` or ESLint 10 / `eslint-config-next`. If it fails for a new UI file, fix that new issue before continuing.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: build exits 0. If build fails due TypeScript or Next.js route issues introduced by this UI work, fix before continuing.

- [ ] **Step 4: Start dev server for screenshots**

Run:

```bash
npm run dev
```

Expected: dev server starts on `http://localhost:3000` or the next available port. Keep the session running until screenshot verification is complete.

- [ ] **Step 5: Verify screenshots with Playwright**

Use Playwright against available routes. If auth-required routes need data/session and cannot be reached, document the blocker and verify public routes plus component states that can be rendered.

Required viewport checks:

```text
375x812
768x1024
1440x1000
```

Required public routes:

```text
/en
/en/pricing
/en/auth/login
```

Authenticated routes to verify with an existing local session or test account:

```text
/en/dashboard
/en/dashboard/settings
/en/pulse/[clientId]
/admin
```

Expected:

- No horizontal page scroll at 375px.
- Sticky nav does not cover content.
- Buttons and icon controls have visible focus.
- Cards and tables use semantic surfaces in both light and dark dashboard modes.
- No structural emoji/glyph controls appear.
- Pulse chart is nonblank and labelled.

- [ ] **Step 6: Stop dev server**

If the dev server was started in a long-running session, stop it with Ctrl-C.

Expected: no task-required command sessions are left running.

- [ ] **Step 7: Final git status**

Run:

```bash
git status --short
```

Expected: only intentional UI polish files are modified. Existing unrelated MCP launcher/test changes may still appear if they were present before this UI work.

- [ ] **Step 8: Commit verification fixes**

If Step 1-5 required any additional fixes, commit them:

```bash
git add <only-ui-polish-files>
git commit -m "fix(ui): address polish verification issues"
```

Expected: commit contains only verification-driven UI fixes.

---

## Self-Review Checklist

- Spec coverage:
  - Public funnel covered by Task 4.
  - Result report covered by Task 5.
  - Dashboard shell/home/workflow/settings covered by Task 6.
  - Pulse covered by Task 7.
  - Admin covered by Task 8.
  - Accessibility, touch targets, reduced motion, and semantic status covered by Tasks 1-3 and Task 9.
- Placeholder scan:
  - No unfinished markers or vague edge-case instructions.
  - Every task names exact files and commands.
- Type consistency:
  - Shared primitives are `AppLogo`, `PageHeader`, `EmptyState`, `TableShell`, `StatusIcon`, `StatusChip`, and `StatusTone`.
  - Tests import the same names from `@/components/ui/*`.
- Scope guard:
  - No API, database, pricing tier, scan, Pulse scheduling, or auth behavior changes are planned.
  - Existing unrelated MCP changes are explicitly excluded.
