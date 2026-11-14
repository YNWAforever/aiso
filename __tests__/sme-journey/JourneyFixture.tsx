'use client'

import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { OpportunityWorkspace } from '@/components/opportunities/OpportunityWorkspace'
import { DraftEditor } from '@/components/work-items/DraftEditor'
import { VersionWorkspace, type VersionWorkspaceProps } from '@/components/change-sets/VersionWorkspace'
import { JourneyMemory } from './transport'
import type { JourneyActor, JourneyScenario, JourneyStage } from './types'

export type JourneyFixtureProps = {
  scenario: JourneyScenario
  mode: 'document' | 'standalone'
  view: 'today' | 'draft' | 'review'
  actor?: JourneyActor
  stage?: JourneyStage
  versionProps?: VersionWorkspaceProps
  todayHtml?: string
  todayStates?: Record<JourneyStage, string>
}

export const journeyCopy = {
  en: {
    title: 'Controlled SME sample', notice: 'Sample data only. Changes stay in this tab. Switching a demo actor is not signing in.',
    bounds: 'This preview uses actual components with local sample responses. It does not verify membership, persist work, contact providers, or change a website. This sample supports recording a delivery; package downloads and provider actions are not included.',
    unsupportedAction: 'This action is not included in the sample. You can record a manual delivery; package downloads and provider actions are unavailable here.',
    owner: 'Sample owner', reviewer: 'Sample independent reviewer', actor: 'Demo actor view', home: 'Sample Today', reset: 'Reset sample',
    dark: 'Dark theme', failures: 'Fail the next read', none: 'No read failure', members: 'Member information', delivery: 'Delivery history', outcomes: 'Saved outcomes',
    lost: 'Lose the next delivery reply', armed: 'Sample failure is ready for the next matching request.', unsupported: 'That destination is outside this controlled sample.',
    instructions: 'Sample instructions and supported draft edits', edits: 'You may inspect and submit the supplied draft unchanged, or save this exact alternative before preparing review. Other edits can be explored, but cannot become a frozen review in this offline sample.',
    titleField: 'Alternative title', actionField: 'Alternative action', notesField: 'Alternative notes', time: 'Suggested declared delivery time (UTC)',
    evidence: 'New delivery records remain self-reported. Immediate outcome windows may have no observation yet; this sample does not collect new evidence.',
  },
  'zh-HK': {
    title: '受控中小企示例', notice: '只用示例資料。修改只留喺呢個分頁。切換示例角色並唔代表登入。',
    bounds: '本預覽使用實際元件及本機示例回應，唔會驗證成員身分、儲存真實工作、連接供應商或修改網站。本示例支援記錄交付，但唔包括下載套件或供應商操作。',
    unsupportedAction: '呢項操作唔喺示例範圍內。你可以記錄手動交付，但喺呢度無法下載套件或使用供應商操作。',
    owner: '示例工作擁有人', reviewer: '示例獨立審批人', actor: '示例角色畫面', home: '示例今日工作', reset: '重設示例',
    dark: '深色主題', failures: '下一次讀取失敗', none: '正常讀取', members: '成員資料', delivery: '交付記錄', outcomes: '已儲存成效',
    lost: '遺失下一次交付回應', armed: '示例故障已準備，會喺下一次相關請求發生。', unsupported: '呢個目的地唔喺受控示例範圍內。',
    instructions: '示例指引及支援嘅草稿修改', edits: '你可以查看並直接提交現有示例草稿，或者先儲存以下完全相同嘅替代內容。其他修改可以試用，但喺離線示例中無法凍結成審批版本。',
    titleField: '替代標題', actionField: '替代行動', notesField: '替代備註', time: '建議申報交付時間（UTC）',
    evidence: '新增交付記錄仍屬自行申報。即時成效時段可能未有觀察資料；本示例唔會收集新證據。',
  },
} as const

/** Real component runtime; only the surrounding sample controls are fixture UI. */
export function JourneyFixture(props: JourneyFixtureProps) {
  if (props.mode === 'standalone') return <StandaloneJourney {...props} />
  const copy = journeyCopy[props.scenario.lang]
  return <>
    <aside className="mx-auto max-w-5xl space-y-2 border-b border-border p-4" aria-label={copy.title}>
      <p className="font-semibold">{copy.title}</p><p>{copy.notice}</p>
      <p>{props.actor === 'reviewer' ? copy.reviewer : copy.owner}</p>
    </aside>
    {props.view === 'today' ? <div dangerouslySetInnerHTML={{ __html: props.todayHtml ?? '' }} />
      : props.view === 'draft' ? <OpportunityWorkspace clientId={props.scenario.ids.clientId} initial={props.scenario.opportunities} smeCopilot />
        : props.versionProps ? <VersionWorkspace {...props.versionProps} /> : null}
  </>
}

/** A sample route must preserve the exact supported destination, including its query. */
export function journeyDestination(href: string, scenario: JourneyScenario): 'today' | 'draft' | 'review' | null {
  if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\')) return null
  const url = new URL(href, 'https://journey.fixture')
  if (url.hash) return null
  const base = `/${scenario.lang}/dashboard/${scenario.ids.clientId}`
  if (url.pathname === base && url.search === '') return 'today'
  if (url.pathname === `${base}/opportunities` && (url.search === '' || url.search === `?draft=${scenario.ids.itemId}`)) return 'draft'
  if (url.pathname === `${base}/tasks` && url.search === '') return 'draft'
  if (url.pathname === `${base}/work-items/${scenario.ids.itemId}/versions` && url.search === '') return 'review'
  return null
}

// Mutations belong to the external sample transport, not React's render state.
function armReadFailure(memory: JourneyMemory, value: string) {
  memory.failNext = value === 'members' || value === 'delivery' || value === 'outcomes' ? value : null
}
function armLostReply(memory: JourneyMemory) { memory.loseNextDeliveryReply = true }

function StandaloneJourney({ scenario, todayStates, view: initialView }: JourneyFixtureProps) {
  const copy = journeyCopy[scenario.lang]
  const [memory] = useState(() => new JourneyMemory(scenario))
  const [actor, setActor] = useState<JourneyActor>('owner')
  const [view, setView] = useState(initialView)
  const [epoch, setEpoch] = useState(0)
  const [notice, setNotice] = useState('')
  const [, refresh] = useState(0)
  const actorRef = useRef(actor), generation = useRef(0)
  useLayoutEffect(() => { actorRef.current = actor }, [actor])

  // Install before child passive effects; never fall back to the native network.
  useLayoutEffect(() => {
    const previous = window.fetch, requests = generation
    window.fetch = async (input, init) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (!raw.startsWith('/api/') || raw.startsWith('//')) throw new TypeError('Outside controlled sample')
      const signal = init?.signal
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const token = generation.current
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined
      // Yield once so abort/reset can invalidate a queued sample request as well.
      await Promise.resolve()
      if (token !== generation.current || signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const reply = memory.request({ actor: actorRef.current, method: init?.method ?? 'GET', path: raw, ...(body === undefined ? {} : { body }) })
      if (reply.status === 422 && (reply.body as { error?: string } | null)?.error === 'SAMPLE_REVISION_NOT_PRECOMPUTED') setNotice(copy.edits)
      if (reply.status === 404) setNotice(copy.unsupportedAction)
      refresh(value => value + 1)
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json', ...reply.headers } })
    }
    return () => { requests.current++; window.fetch = previous }
  }, [memory, copy.edits, copy.unsupportedAction])

  function navigate(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href]')
    if (!anchor || anchor.hasAttribute('download')) return
    event.preventDefault()
    const destination = journeyDestination(anchor.getAttribute('href') ?? '', scenario)
    if (!destination) { setNotice(copy.unsupported); return }
    setView(destination); setNotice(''); setEpoch(value => value + 1)
    // File mode uses an internal route; document tests exercise real ?draft restoration.
    window.history.replaceState(null, '', '#' + destination)
  }
  function reset() {
    generation.current++; memory.reset(); setActor('owner'); setView('today'); setNotice(''); setEpoch(value => value + 1)
    window.history.replaceState(null, '', '#today')
  }
  const control = 'min-h-11 rounded border border-border bg-background px-3 py-2 text-foreground'
  const alternative = scenario.canonicalDrafts[1] ?? scenario.draft
  return <>
    <aside className="mx-auto max-w-5xl space-y-3 border-b border-border bg-background p-4 text-foreground" aria-label={copy.title}>
      <h1 className="text-lg font-semibold">{copy.title}</h1><p>{copy.notice}</p><p>{copy.bounds}</p>
      <div className="flex flex-wrap items-center gap-3">
        <label>{copy.actor} <select className={control} value={actor} onChange={event => { generation.current++; setActor(event.target.value as JourneyActor); setEpoch(value => value + 1) }}>
          <option value="owner">{copy.owner}</option><option value="reviewer">{copy.reviewer}</option>
        </select></label>
        <button type="button" className={control} onClick={() => { setView('today'); setEpoch(value => value + 1) }}>{copy.home}</button>
        <button type="button" className={control} onClick={reset}>{copy.reset}</button>
        <label className="inline-flex min-h-11 items-center gap-2"><input type="checkbox" onChange={event => document.documentElement.classList.toggle('dark', event.target.checked)} />{copy.dark}</label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label>{copy.failures} <select className={control} value={memory.failNext ?? ''} onChange={event => { armReadFailure(memory, event.target.value); setNotice(copy.armed); refresh(value => value + 1) }}>
          <option value="">{copy.none}</option><option value="members">{copy.members}</option><option value="delivery">{copy.delivery}</option><option value="outcomes">{copy.outcomes}</option>
        </select></label>
        <button type="button" className={control} onClick={() => { armLostReply(memory); setNotice(copy.armed) }}>{copy.lost}</button>
      </div>
      <p role="status" aria-live="polite">{notice}</p>
      <details><summary className="min-h-11 cursor-pointer py-2 font-semibold">{copy.instructions}</summary>
        <p>{copy.edits}</p><dl className="space-y-2 break-words">
          <dt>{copy.titleField}</dt><dd>{alternative.title}</dd><dt>{copy.actionField}</dt><dd className="whitespace-pre-wrap">{alternative.action}</dd>
          <dt>{copy.notesField}</dt><dd className="whitespace-pre-wrap">{alternative.notes}</dd><dt>{copy.time}</dt><dd>{scenario.deliveredAt}</dd>
        </dl><p>{copy.evidence}</p>
      </details>
    </aside>
    <div onClick={navigate}>
      {view === 'today' ? <div dangerouslySetInnerHTML={{ __html: todayStates?.[memory.stage] ?? '' }} />
        : view === 'draft' ? <main className="mx-auto max-w-5xl p-4"><DraftEditor key={`draft:${epoch}:${actor}`} clientId={scenario.ids.clientId} item={memory.draft} smeCopilot onSaved={() => refresh(value => value + 1)} /></main>
          : <VersionWorkspace key={`review:${epoch}:${actor}`} {...memory.versionProps(actor)} />}
    </div>
  </>
}
