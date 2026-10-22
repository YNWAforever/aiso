'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { FileText, Gauge, Radar, Search, Wrench } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { CommandPalette } from '@/components/ui/command-palette'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DataTable } from '@/components/ui/data-table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Progress } from '@/components/ui/progress'
import { ScoreBadge } from '@/components/ui/score-badge'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton, SkeletonText } from '@/components/ui/skeleton'
import { StatCard } from '@/components/ui/stat-card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToastProvider, useToast } from '@/components/ui/toast'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { AnimatedSteps } from '@/components/visuals/AnimatedStep'
import { CheckHeatmap, type HeatmapCheck } from '@/components/visuals/CheckHeatmap'
import { HeroDemo } from '@/components/visuals/HeroDemo'
import { ReducedMotionPreview } from '@/components/visuals/MotionRoot'
import { PillarGauge } from '@/components/visuals/PillarGauge'
import { PlatformDots, type PlatformCell } from '@/components/visuals/PlatformDots'
import { PotentialScoreBar } from '@/components/visuals/PotentialScoreBar'
import { ScanTimeline, type TimelineCheck } from '@/components/visuals/ScanTimeline'
import { ScoreRing } from '@/components/visuals/ScoreRing'
import { Sparkline } from '@/components/visuals/Sparkline'
import { GRADES, type CheckStatus, type Pillar } from '@/components/visuals/tone'

// Fixture data. Check keys and names are the product's real ones (messages
// `checks.*`); the statuses are invented for the preview.
const CHECKS: readonly { key: string; bucket: Pillar; status: CheckStatus }[] = [
  { key: 'c1_robots', bucket: 'core', status: 'pass' },
  { key: 'c2_llms_txt', bucket: 'core', status: 'fail' },
  { key: 'c3_bot_access', bucket: 'core', status: 'pass' },
  { key: 'c4_structured_data', bucket: 'core', status: 'warn' },
  { key: 'c5_extractability', bucket: 'core', status: 'pass' },
  { key: 'c6_llms_full_txt', bucket: 'extended', status: 'unknown' },
  { key: 'c7_mcp_card', bucket: 'extended', status: 'fail' },
  { key: 'c8_sitemap', bucket: 'extended', status: 'pass' },
  { key: 'c9_meta_desc', bucket: 'extended', status: 'pass' },
  { key: 'c10_headings', bucket: 'extended', status: 'warn' },
  { key: 'c11_faq', bucket: 'extended', status: 'fail' },
  { key: 'c12_canonical', bucket: 'extended', status: 'pass' },
  { key: 'c13_render', bucket: 'extended', status: 'pass' },
  { key: 'c14_internal_links', bucket: 'extended', status: 'pass' },
  { key: 'c15_entity', bucket: 'extended', status: 'warn' },
  { key: 'c16_freshness', bucket: 'extended', status: 'pass' },
  { key: 'c17_citation_density', bucket: 'geo', status: 'warn' },
  { key: 'c18_factual_density', bucket: 'geo', status: 'pass' },
  { key: 'c19_topical_authority', bucket: 'geo', status: 'fail' },
  { key: 'c20_chunkability', bucket: 'geo', status: 'pass' },
]

const PLATFORMS = [
  { id: 'chatgpt', key: 'chatgpt' }, { id: 'perplexity', key: 'perplexity' },
  { id: 'google', key: 'googleAi' }, { id: 'gemini', key: 'gemini' },
] as const
const CELLS: Record<string, PlatformCell[]> = {
  chatgpt: ['absent', 'mentioned', 'mentioned', 'cited', 'cited', 'cited'],
  perplexity: ['mentioned', 'cited', 'cited', 'cited', 'mentioned', 'cited'],
  google: ['notRun', 'absent', 'absent', 'mentioned', 'mentioned', 'cited'],
  gemini: ['absent', 'absent', 'notRun', 'absent', 'mentioned', 'mentioned'],
}

type Brand = { id: string; name: string; score: number; grade: string; scans: number }

export function DesignSystemGallery() {
  const [reduced, setReduced] = useState(false)
  return (
    <ToastProvider>
      <ReducedMotionPreview setting={reduced ? 'always' : 'user'}>
        <Gallery reduced={reduced} onReducedChange={setReduced} />
      </ReducedMotionPreview>
    </ToastProvider>
  )
}

function Gallery({ reduced, onReducedChange }: { reduced: boolean; onReducedChange: (value: boolean) => void }) {
  const t = useTranslations('designSystem')
  const checkNames = useTranslations('checks')
  const v = useTranslations('visuals')
  const locale = useLocale()
  const otherLocale = locale === 'en' ? 'zh-HK' : 'en'
  const [dark, setDark] = useState(false)
  const [replay, setReplay] = useState(0)

  useEffect(() => {
    // Read once after mount: the theme lives on <html>, set by the root layout's script.
    const id = requestAnimationFrame(() => setDark(document.documentElement.classList.contains('dark')))
    return () => cancelAnimationFrame(id)
  }, [])

  function toggleTheme() {
    const next = !dark
    document.documentElement.classList.toggle('dark', next)
    setDark(next)
  }

  const heatmapChecks: HeatmapCheck[] = CHECKS.map(c => ({ ...c, label: checkNames(c.key) }))

  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-4 py-10 sm:px-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        breadcrumbs={[{ label: t('crumbDev') }, { label: t('title') }]}
        actions={<>
          <Button variant="outline" size="sm" onClick={toggleTheme} aria-pressed={dark}>{t('controls.dark')}</Button>
          <Button variant="outline" size="sm" onClick={() => onReducedChange(!reduced)} aria-pressed={reduced}>{t('controls.reducedMotion')}</Button>
          <Button asChild variant="outline" size="sm"><Link href={`/${otherLocale}/dev/design-system`} hrefLang={otherLocale}>{t('controls.language')}</Link></Button>
        </>}
      />

      <Section title={t('sections.foundations')}>
        <Sub title={t('foundations.neutral')}>
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
            {['bg-neutral-1', 'bg-neutral-2', 'bg-neutral-3', 'bg-neutral-4', 'bg-neutral-5', 'bg-neutral-6', 'bg-neutral-7', 'bg-neutral-8', 'bg-neutral-9', 'bg-neutral-10', 'bg-neutral-11', 'bg-neutral-12'].map((cls, i) => (
              <div key={cls} className="flex flex-col items-center gap-1">
                <span className={cn('h-10 w-full rounded-md border border-border', cls)} />
                <span className="text-xs text-muted-foreground">{i + 1}</span>
              </div>
            ))}
          </div>
        </Sub>
        <Sub title={t('foundations.tones')}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Swatch solid="bg-primary" soft="bg-accent" fg="text-accent-foreground" name={t('foundations.brand')} />
            <Swatch solid="bg-tone-success" soft="bg-tone-success-soft" fg="text-tone-success-fg" name={t('foundations.success')} />
            <Swatch solid="bg-tone-warning" soft="bg-tone-warning-soft" fg="text-tone-warning-fg" name={t('foundations.warning')} />
            <Swatch solid="bg-tone-danger" soft="bg-tone-danger-soft" fg="text-tone-danger-fg" name={t('foundations.danger')} />
            <Swatch solid="bg-tone-info" soft="bg-tone-info-soft" fg="text-tone-info-fg" name={t('foundations.info')} />
          </div>
        </Sub>
        <Sub title={t('foundations.type')}>
          <div className="flex flex-col gap-2">
            <p className="text-display font-black leading-tight text-foreground">{t('foundations.sample')}</p>
            <p className="text-3xl font-black text-foreground">{t('foundations.sample')}</p>
            <p className="text-2xl font-bold text-foreground">{t('foundations.sample')}</p>
            <p className="text-xl font-bold text-foreground">{t('foundations.sample')}</p>
            <p className="text-lg text-foreground">{t('foundations.body')}</p>
            <p className="text-base text-foreground">{t('foundations.body')}</p>
            <p className="text-sm text-muted-foreground">{t('foundations.body')}</p>
            <p className="text-xs text-muted-foreground">{t('foundations.body')}</p>
          </div>
        </Sub>
        <Sub title={t('foundations.elevation')}>
          <div className="grid grid-cols-3 gap-4">
            {['shadow-e1', 'shadow-e2', 'shadow-e3'].map(cls => (
              <div key={cls} className={cn('flex h-20 items-center justify-center rounded-lg bg-card text-sm font-semibold text-foreground', cls)}>{cls.replace('shadow-', '')}</div>
            ))}
          </div>
        </Sub>
      </Section>

      <Section title={t('sections.visuals')}>
        <Sub title="ScoreRing · ScoreBadge">
          <div className="flex flex-wrap items-end gap-8">
            <ScoreRing score={38} grade="F" size="sm" />
            <ScoreRing score={68} grade="C" previous={64} />
            <ScoreRing score={86} grade="A" previous={88} size="lg" />
          </div>
          <div className="flex flex-wrap gap-2">
            {GRADES.map(grade => <ScoreBadge key={grade} grade={grade} />)}
            <ScoreBadge grade="B" showLabel={false} size="lg" />
          </div>
        </Sub>
        <Sub title="PotentialScoreBar">
          <PotentialScoreBar current={68} potential={86} className="max-w-xl" />
        </Sub>
        <Sub title="PillarGauge">
          <div className="flex flex-wrap gap-8">
            <PillarGauge pillar="core" earned={38} />
            <PillarGauge pillar="extended" earned={18} />
            <PillarGauge pillar="geo" earned={9} />
          </div>
        </Sub>
        <Sub title="CheckHeatmap">
          <HeatmapWithDrawer checks={heatmapChecks} />
        </Sub>
        <Sub title="ScanTimeline">
          <SimulatedScan key={replay} checks={heatmapChecks} />
          <Button variant="outline" size="sm" className="w-fit" onClick={() => setReplay(n => n + 1)}>{t('replay')}</Button>
        </Sub>
        <Sub title="Sparkline · PlatformDots">
          <div className="flex items-center gap-3">
            <Sparkline points={[52, 55, 54, 60, 63, 62, 68]} label={t('sample.score')} />
            <Sparkline points={[9, 8, 8, 6, 7, 5, 4]} label={t('sample.failing')} />
          </div>
          <PlatformDots
            caption={t('sample.platformCaption')}
            platforms={PLATFORMS.map(p => ({ id: p.id, name: v(`heroDemo.platforms.${p.key}`) }))}
            weeks={['1', '2', '3', '4', '5', '6'].map(n => t('sample.week', { n }))}
            cells={CELLS}
          />
        </Sub>
        <Sub title="AnimatedSteps">
          <AnimatedSteps
            label={t('sample.stepsLabel')}
            steps={[
              { icon: <Search />, title: t('sample.stepScan'), description: t('sample.stepScanBody') },
              { icon: <Wrench />, title: t('sample.stepFix'), description: t('sample.stepFixBody') },
              { icon: <Radar />, title: t('sample.stepMonitor'), description: t('sample.stepMonitorBody') },
            ]}
          />
        </Sub>
        <Sub title="HeroDemo">
          <HeroDemo />
        </Sub>
      </Section>

      <Section title={t('sections.components')}>
        <Sub title="StatCard">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label={t('sample.score')} value="68" delta={4} deltaText={t('sample.pts', { n: 4 })} trend={[52, 55, 54, 60, 63, 62, 68]} href="#" />
            <StatCard label={t('sample.failing')} value="4" delta={-2} invertDelta trend={[9, 8, 8, 6, 7, 5, 4]} />
            <StatCard label={t('sample.fixesDone')} value="5 / 9" delta={0} />
          </div>
        </Sub>
        <Sub title="DataTable">
          <BrandTable />
        </Sub>
        <Sub title="EmptyState · Skeleton">
          <div className="grid gap-4 sm:grid-cols-2">
            <EmptyState illustration="scan" title={t('sample.emptyTitle')} description={t('sample.emptyBody')} action={<Button>{t('sample.emptyAction')}</Button>} />
            <EmptyState illustration="error" title={t('sample.errorTitle')} description={t('sample.errorBody')} action={<Button variant="outline">{t('sample.retry')}</Button>} />
          </div>
          <div aria-busy="true" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
            <span className="sr-only">{t('sample.loading')}</span>
            <Skeleton className="h-6 w-40" />
            <SkeletonText lines={3} />
          </div>
        </Sub>
        <Sub title="Tabs · Tooltip · Progress">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">{t('sample.tabOverview')}</TabsTrigger>
              <TabsTrigger value="fixes">{t('sample.tabFixes')}</TabsTrigger>
              <TabsTrigger value="tasks">{t('sample.tabTasks')}</TabsTrigger>
            </TabsList>
            <TabsContent value="overview"><Progress value={68} aria-label={t('sample.score')} /></TabsContent>
            <TabsContent value="fixes"><Progress value={55} aria-label={t('sample.fixesDone')} /></TabsContent>
            <TabsContent value="tasks"><Progress value={20} aria-label={t('sample.tabTasks')} /></TabsContent>
          </Tabs>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild><Button variant="outline" size="sm" className="w-fit"><Gauge />{t('sample.tooltipTrigger')}</Button></TooltipTrigger>
              <TooltipContent>{t('sample.tooltip')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Sub>
        <Sub title="Toast · ConfirmDialog · Dialog · CommandPalette">
          <Overlays />
        </Sub>
      </Section>
    </main>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-8">
      <h2 className="border-b border-border pb-2 text-2xl font-black text-foreground">{title}</h2>
      {children}
    </section>
  )
}

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-mono text-sm font-semibold text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}

function Swatch({ solid, soft, fg, name }: { solid: string; soft: string; fg: string; name: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <span className={cn('block h-10', solid)} />
      <span className={cn('block px-3 py-2 text-sm font-semibold', soft, fg)}>{name}</span>
    </div>
  )
}

function HeatmapWithDrawer({ checks }: { checks: HeatmapCheck[] }) {
  const t = useTranslations('designSystem')
  const v = useTranslations('visuals')
  const [selected, setSelected] = useState<string | null>(null)
  // The sheet has no Trigger of its own, so focus is handed back to the tile by hand.
  const opener = useRef<HTMLElement | null>(null)
  const check = checks.find(c => c.key === selected)
  return (
    <>
      <CheckHeatmap checks={checks} onSelect={key => { opener.current = document.activeElement as HTMLElement | null; setSelected(key) }} selectedKey={selected} />
      <Sheet open={Boolean(check)} onOpenChange={open => { if (!open) setSelected(null) }}>
        <SheetContent onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus() }}>
          {check && (
            <>
              <SheetHeader>
                <SheetTitle className="text-lg font-bold text-foreground">{check.label}</SheetTitle>
                <SheetDescription className="text-sm text-muted-foreground">{v(`status.${check.status}`)}</SheetDescription>
              </SheetHeader>
              <pre className="overflow-x-auto rounded-lg bg-neutral-12 p-4 text-xs text-neutral-1"><code>{t('sample.code')}</code></pre>
              <Button className="w-fit"><FileText />{t('sample.generateFix')}</Button>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

/** Steps a fake scan through every check so the timeline can be seen moving. */
function SimulatedScan({ checks }: { checks: HeatmapCheck[] }) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (step > checks.length) return
    const timer = setTimeout(() => setStep(s => s + 1), 280)
    return () => clearTimeout(timer)
  }, [step, checks.length])

  const timeline: TimelineCheck[] = checks.map((c, i) => ({
    key: c.key, label: c.label, bucket: c.bucket,
    status: i < step ? c.status : i === step ? 'running' : 'pending',
  }))
  const points = { pass: 5, warn: 2.5, fail: 0, unknown: 0 } as const
  const settled = checks.slice(0, Math.min(step, checks.length))
  const score = settled.length ? settled.reduce((sum, c) => sum + points[c.status], 0) : null
  return <ScanTimeline checks={timeline} score={score} />
}

function BrandTable() {
  const t = useTranslations('designSystem')
  const rows: Brand[] = [
    { id: 'a', name: t('sample.brandA'), score: 68, grade: 'C', scans: 6 },
    { id: 'b', name: t('sample.brandB'), score: 82, grade: 'A', scans: 12 },
    { id: 'c', name: t('sample.brandC'), score: 47, grade: 'F', scans: 2 },
  ]
  return (
    <DataTable<Brand>
      caption={t('sample.tableCaption')}
      filterable
      rows={rows}
      getRowId={row => row.id}
      columns={[
        { key: 'name', header: t('sample.colBrand'), cell: row => row.name, value: row => row.name },
        { key: 'score', header: t('sample.colScore'), cell: row => <span className="inline-flex items-center gap-2">{row.score}<ScoreBadge grade={row.grade} showLabel={false} size="sm" /></span>, value: row => row.score, align: 'right' },
        { key: 'scans', header: t('sample.colScans'), cell: row => row.scans, value: row => row.scans, align: 'right' },
      ]}
    />
  )
}

function Overlays() {
  const t = useTranslations('designSystem')
  const { toast } = useToast()
  const locale = useLocale()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => toast({ title: t('sample.toastTitle'), description: t('sample.toastBody'), tone: 'success' })}>{t('sample.showToast')}</Button>
      <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>{t('sample.showConfirm')}</Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('sample.confirmTitle')}
        description={t('sample.confirmBody')}
        confirmLabel={t('sample.confirmAction')}
        destructive
        onConfirm={() => toast({ title: t('sample.removed'), tone: 'info' })}
      />
      <Dialog>
        <DialogTrigger asChild><Button variant="outline" size="sm">{t('sample.showDialog')}</Button></DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('sample.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('sample.dialogBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter><Button>{t('sample.ok')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Button variant="outline" size="sm" onClick={() => setPaletteOpen(true)}>{t('sample.showPalette')}</Button>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={[
          { id: 'overview', label: t('sample.navOverview'), group: t('sample.groupPages'), href: `/${locale}/dev/design-system#main` },
          { id: 'scan', label: t('sample.navScan'), group: t('sample.groupPages'), href: `/${locale}/dev/design-system#main` },
          { id: 'reports', label: t('sample.navReports'), group: t('sample.groupPages'), href: `/${locale}/dev/design-system#main` },
          { id: 'toast', label: t('sample.showToast'), group: t('sample.groupActions'), onSelect: () => toast({ title: t('sample.toastTitle'), tone: 'success' }) },
        ]}
      />
    </div>
  )
}
