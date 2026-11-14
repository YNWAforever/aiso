'use client'

import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { OpportunityWorkspace } from '@/components/opportunities/OpportunityWorkspace'
import { DraftEditor } from '@/components/work-items/DraftEditor'
import { VersionWorkspace, type VersionWorkspaceProps } from '@/components/change-sets/VersionWorkspace'
import { JourneyMemory } from './transport'
import type { JourneyActor, JourneyObservationProfile, JourneyScenario, JourneyStage } from './types'

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
    bounds: 'This offline preview supports one prepared review version: choose either supplied draft text, use the supported delivery time, and record at most two delivery declarations with their withdrawals. Work stays in this tab; no membership is verified and no provider or website is contacted.',
    sampleKind: 'Sample evidence package', mixedKind: 'Scan and Pulse, with a repeated scan source (V2)', oneScanKind: 'One scan source (V2)', legacyKind: 'Original single-source review (V1)',
    observationControls: 'Sample time and saved records', evaluationTime: 'Sample evaluation time (UTC)', earlyRead: 'Early read', matureRead: 'D7 window has ended',
    advanceTime: 'Advance sample time past D7', rewindTime: 'To return to the earlier time, use Reset sample. Reset clears this tab’s sample work.',
    observationProfile: 'Saved records for this read', retainedRecords: 'Available saved records', unavailableScanRecords: 'Saved scan records unavailable', limitedScanRecords: 'Saved scan records exceed the read limit', undatedRecords: 'Many records with no collection date',
    refreshHint: 'After changing the time or saved records, use Refresh outcomes in the saved outcomes section to read this choice. These controls do not collect evidence.',
    readChanged: 'Sample time or saved records changed. Use Refresh outcomes in the saved outcomes section to read this choice.',
    readUnavailable: 'A sample read failed. Use the retry action in that section; no saved sample work was changed.',
    transitionUnsupported: 'This offline sample accepts only the listed delivery time and at most two delivery declarations. Reset the sample to start another attempt.',
    alternatives: 'The two supplied texts are alternative first submissions for one review version, not version history. Reset to choose again after preparing review. The review starts with its evidence already supplied; this sample has no source attachment or removal controls.',
    unsupportedAction: 'This action is not included in the sample. You can record a manual delivery; package downloads and provider actions are unavailable here.',
    owner: 'Sample owner', reviewer: 'Sample independent reviewer', actor: 'Demo actor view', home: 'Sample Today', reset: 'Reset sample',
    dark: 'Dark theme', failures: 'Fail the next read', none: 'No read failure', members: 'Member information', delivery: 'Delivery history', outcomes: 'Saved outcomes',
    lost: 'Lose the next delivery reply', armed: 'Sample failure is ready for the next matching request.', unsupported: 'That destination is outside this controlled sample.',
    instructions: 'Sample instructions and supported draft edits', edits: 'You may inspect and submit the supplied draft unchanged, or save this exact alternative before preparing review. Other edits can be explored, but cannot become a frozen review in this offline sample.',
    titleField: 'Alternative title', actionField: 'Alternative action', notesField: 'Alternative notes', time: 'Supported declared delivery time (UTC)',
    evidence: 'All observations here are fictional saved records; no new evidence is collected. New delivery records remain self-reported. An available scan comparison remains only partially comparable; Pulse collection results are not ranked as improvement or regression.',
  },
  'zh-HK': {
    title: '受控中小企示例', notice: '只用示例資料。修改只留喺呢個分頁。切換示例角色並唔代表登入。',
    bounds: '本離線預覽支援準備一個審批版本：揀其中一份指定草稿文字、使用指定交付時間，最多記錄兩次交付聲明及各自嘅撤回。修改只留喺呢個分頁，唔會驗證成員身分、連接供應商或修改網站。',
    sampleKind: '示例證據組合', mixedKind: '掃描及 Pulse，包含一個重複掃描來源（V2）', oneScanKind: '單一掃描來源（V2）', legacyKind: '原有單一來源審批（V1）',
    observationControls: '示例時間及已儲存記錄', evaluationTime: '示例評估時間（UTC）', earlyRead: '較早嘅讀取時間', matureRead: 'D7 時段已結束',
    advanceTime: '將示例時間推進至 D7 結束之後', rewindTime: '要返回較早時間，請按「重設示例」。重設會清除呢個分頁嘅示例工作。',
    observationProfile: '本次讀取嘅已儲存記錄', retainedRecords: '可讀取嘅已儲存記錄', unavailableScanRecords: '已儲存掃描記錄無法讀取', limitedScanRecords: '已儲存掃描記錄超出讀取上限', undatedRecords: '大量記錄未有收集日期',
    refreshHint: '改動時間或記錄後，請喺已儲存成效區按「重新整理成效」，讀取呢個選擇。呢啲控制唔會收集新證據。',
    readChanged: '示例時間或記錄已改動。請喺已儲存成效區按「重新整理成效」，讀取呢個選擇。',
    readUnavailable: '剛才嘅示例讀取失敗，請喺該區按重試；已儲存嘅示例工作未有改動。',
    transitionUnsupported: '本離線示例只接受指定交付時間，最多記錄兩次交付聲明。要再試，請先重設示例。',
    alternatives: '兩份指定文字係同一審批版本首次提交嘅兩個選擇，唔係版本歷史。準備審批後要改揀另一份，請先重設示例。審批證據一開始已經提供；本示例冇附加或移除來源嘅操作。',
    unsupportedAction: '呢項操作唔喺示例範圍內。你可以記錄手動交付，但喺呢度無法下載套件或使用供應商操作。',
    owner: '示例工作擁有人', reviewer: '示例獨立審批人', actor: '示例角色畫面', home: '示例今日工作', reset: '重設示例',
    dark: '深色主題', failures: '下一次讀取失敗', none: '正常讀取', members: '成員資料', delivery: '交付記錄', outcomes: '已儲存成效',
    lost: '遺失下一次交付回應', armed: '示例故障已準備，會喺下一次相關請求發生。', unsupported: '呢個目的地唔喺受控示例範圍內。',
    instructions: '示例指引及支援嘅草稿修改', edits: '你可以查看並直接提交現有示例草稿，或者先儲存以下完全相同嘅替代內容。其他修改可以試用，但喺離線示例中無法凍結成審批版本。',
    titleField: '替代標題', actionField: '替代行動', notesField: '替代備註', time: '示例支援嘅申報交付時間（UTC）',
    evidence: '呢度嘅觀察全部係虛構嘅已儲存記錄，唔會收集新證據。新增交付記錄仍屬自行申報。可用嘅掃描比較仍然只屬部分可比較；Pulse 收集結果唔會排列為改善或倒退。',
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
      const code = (reply.body as { error?: string } | null)?.error
      if (reply.status === 422 && code === 'SAMPLE_REVISION_NOT_PRECOMPUTED') setNotice(copy.edits + ' ' + copy.alternatives)
      if (reply.status === 422 && code === 'SAMPLE_TRANSITION_NOT_PRECOMPUTED') setNotice(copy.transitionUnsupported)
      if (reply.status === 503 && (init?.method ?? 'GET') === 'GET') setNotice(copy.readUnavailable)
      if (reply.status === 404) setNotice(copy.unsupportedAction)
      refresh(value => value + 1)
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json', ...reply.headers } })
    }
    return () => { requests.current++; window.fetch = previous }
  }, [memory, copy.edits, copy.alternatives, copy.transitionUnsupported, copy.readUnavailable, copy.unsupportedAction])

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
  const control = 'min-h-11 max-w-full whitespace-normal rounded border border-border bg-background px-3 py-2 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default disabled:opacity-50'
  const alternative = scenario.canonicalDrafts[1] ?? scenario.draft
  const kindLabel = scenario.kind === 'v2-mixed' ? copy.mixedKind : scenario.kind === 'v2-one-scan' ? copy.oneScanKind : copy.legacyKind
  return <>
    <aside className="mx-auto max-w-5xl space-y-3 border-b border-border bg-background p-4 text-foreground" aria-label={copy.title}>
      <h1 className="text-lg font-semibold">{copy.title}</h1><p>{copy.notice}</p><p>{copy.bounds}</p>
      <p className="break-words"><span className="font-semibold">{copy.sampleKind}:</span> {kindLabel}</p>
      <div className="flex flex-wrap items-center gap-3">
        <label>{copy.actor} <select className={control} value={actor} onChange={event => { generation.current++; setActor(event.target.value as JourneyActor); setEpoch(value => value + 1) }}>
          <option value="owner">{copy.owner}</option><option value="reviewer">{copy.reviewer}</option>
        </select></label>
        <button type="button" className={control} onClick={() => { setView('today'); setEpoch(value => value + 1) }}>{copy.home}</button>
        <button type="button" className={control} onClick={reset}>{copy.reset}</button>
        <label className="inline-flex min-h-11 items-center gap-2"><input type="checkbox" onChange={event => document.documentElement.classList.toggle('dark', event.target.checked)} />{copy.dark}</label>
      </div>
      <fieldset className="min-w-0 space-y-3 rounded-lg border border-border p-3">
        <legend className="px-1 font-semibold">{copy.observationControls}</legend>
        <p className="break-words">{copy.evaluationTime}: <time className="break-all" dateTime={memory.clock}>{memory.clock}</time> · {memory.clockKey === 'mature-d7' ? copy.matureRead : copy.earlyRead}</p>
        <div className="flex min-w-0 flex-wrap items-end gap-3">
          <button type="button" className={control} disabled={memory.clockKey === 'mature-d7'} onClick={() => {
            memory.setClock('mature-d7'); setNotice(copy.readChanged); refresh(value => value + 1)
          }}>{copy.advanceTime}</button>
          <label className="flex min-w-0 max-w-full flex-col gap-1">{copy.observationProfile}
            <select className={control} value={memory.observationProfile} onChange={event => {
              memory.setObservationProfile(event.target.value as JourneyObservationProfile); setNotice(copy.readChanged); refresh(value => value + 1)
            }}>
              <option value="stored">{copy.retainedRecords}</option>
              <option value="unavailable-scan">{copy.unavailableScanRecords}</option>
              <option value="limited-scan">{copy.limitedScanRecords}</option>
              <option value="diagnostic-heavy">{copy.undatedRecords}</option>
            </select>
          </label>
        </div>
        <p className="text-sm">{copy.refreshHint}</p><p className="text-sm text-muted-foreground">{copy.rewindTime}</p>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <label>{copy.failures} <select className={control} value={memory.failNext ?? ''} onChange={event => { armReadFailure(memory, event.target.value); setNotice(copy.armed); refresh(value => value + 1) }}>
          <option value="">{copy.none}</option><option value="members">{copy.members}</option><option value="delivery">{copy.delivery}</option><option value="outcomes">{copy.outcomes}</option>
        </select></label>
        <button type="button" className={control} onClick={() => { armLostReply(memory); setNotice(copy.armed) }}>{copy.lost}</button>
      </div>
      <p role="status" aria-live="polite">{notice}</p>
      <details><summary className="min-h-11 cursor-pointer py-2 font-semibold">{copy.instructions}</summary>
        <p>{copy.edits}</p><p>{copy.alternatives}</p><dl className="space-y-2 break-words">
          <dt>{copy.titleField}</dt><dd>{alternative.title}</dd><dt>{copy.actionField}</dt><dd className="whitespace-pre-wrap">{alternative.action}</dd>
          <dt>{copy.notesField}</dt><dd className="whitespace-pre-wrap">{alternative.notes}</dd><dt>{copy.time}</dt><dd><time className="break-all" dateTime={scenario.deliveredAt}>{scenario.deliveredAt}</time></dd>
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
