import { describe, expect, it, vi } from 'vitest'
import {
  AnalyticsApiError, classifyAnalyticsFailure, listKeyEvents, listProperties, listWebStreams, runKeyEventReport,
} from '@/lib/integrations/analytics/client'
import { DeadlineReachedError } from '@/lib/integrations/search-console/client'
import accountSummaries from '../fixtures/ga4/account-summaries.json'
import dataStreams from '../fixtures/ga4/data-streams.json'
import keyEvents from '../fixtures/ga4/key-events.json'
import reportPage1 from '../fixtures/ga4/run-report-page1.json'
import reportPage2 from '../fixtures/ga4/run-report-page2.json'
import reportThresholded from '../fixtures/ga4/run-report-thresholded.json'
import errorScope from '../fixtures/ga4/error-scope.json'
import errorPermission from '../fixtures/ga4/error-permission.json'
import errorServiceDisabled from '../fixtures/ga4/error-service-disabled.json'
import errorQuota from '../fixtures/ga4/error-quota.json'

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const json = (status: number, body: unknown) => vi.fn().mockResolvedValue(res(status, body))
const raw = (status: number, text: string) => vi.fn().mockResolvedValue(new Response(text, { status }))
const sequence = (...responses: Response[]) => {
  const f = vi.fn()
  for (const r of responses) f.mockResolvedValueOnce(r)
  return f
}

const ADMIN = 'https://analyticsadmin.googleapis.com/v1beta'
const DATA = 'https://analyticsdata.googleapis.com/v1beta'

const REPORT_INPUT = {
  propertyId: '111', streamId: '1001', eventNames: ['generate_lead', 'purchase'],
  startDate: '2026-09-22', endDate: '2026-09-29', deadline: Date.now() + 60_000,
}

describe('classifyAnalyticsFailure', () => {
  it.each([
    ['scope reason', 403, errorScope, 'scope_missing'],
    ['SERVICE_DISABLED', 403, errorServiceDisabled, 'misconfigured'],
    ['plain 403', 403, errorPermission, 'access_lost'],
    ['404', 404, { error: { code: 404, status: 'NOT_FOUND' } }, 'access_lost'],
    ['429', 429, errorQuota, 'quota'],
    ['RESOURCE_EXHAUSTED on a non-429', 503, errorQuota, 'quota'],
    ['401', 401, { error: { code: 401, status: 'UNAUTHENTICATED' } }, 'unavailable'],
    ['500', 500, {}, 'unavailable'],
    ['unreadable body', 502, null, 'unavailable'],
  ])('%s -> %s', (_name, status, body, kind) => {
    expect(classifyAnalyticsFailure(status as number, body)).toBe(kind)
  })

  it('treats the scope reason as scope_missing even on a PERMISSION_DENIED status', () => {
    expect(classifyAnalyticsFailure(403, errorScope)).toBe('scope_missing')
  })
})

describe('AnalyticsApiError', () => {
  it('carries kind, status and code without a body-derived message', () => {
    const e = new AnalyticsApiError('quota', 429, 'RESOURCE_EXHAUSTED')
    expect(e).toMatchObject({ kind: 'quota', status: 429, code: 'RESOURCE_EXHAUSTED' })
    expect(e).toBeInstanceOf(Error)
  })
})

describe('failures from the API', () => {
  it.each([
    [errorScope, 403, 'scope_missing', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'],
    [errorServiceDisabled, 403, 'misconfigured', 'SERVICE_DISABLED'],
    [errorPermission, 403, 'access_lost', 'PERMISSION_DENIED'],
    [errorQuota, 429, 'quota', 'RESOURCE_EXHAUSTED'],
  ])('listProperties maps a %#th error fixture to a typed failure', async (body, status, kind, code) => {
    await expect(listProperties('t', json(status, body))).rejects.toMatchObject({ kind, status, code })
  })

  it('maps a network error to unavailable with status 0', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    await expect(listProperties('t', f)).rejects.toMatchObject({ kind: 'unavailable', status: 0 })
  })

  it('rejects a non-JSON 200 as unavailable rather than an empty list', async () => {
    await expect(listProperties('t', raw(200, 'not json'))).rejects
      .toMatchObject({ kind: 'unavailable', status: 200, code: 'malformed_body' })
  })

  it('rejects a JSON null 200 as unavailable', async () => {
    await expect(listWebStreams('t', '111', raw(200, 'null'))).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('never puts the response body in the thrown error', async () => {
    const f = json(403, { error: { status: 'PERMISSION_DENIED', message: 'SECRET-BODY-TEXT' } })
    const err: unknown = await listProperties('t', f).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AnalyticsApiError)
    expect((err as Error).message).not.toContain('SECRET-BODY-TEXT')
  })

  it('sends the bearer token and a timeout signal on every call', async () => {
    const f = json(200, {})
    await listProperties('ya29.t', f)
    const [, init] = f.mock.calls[0]!
    expect(init.headers.authorization).toBe('Bearer ya29.t')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('listProperties', () => {
  it('flattens property summaries into ids and names', async () => {
    const f = json(200, accountSummaries)
    expect(await listProperties('t', f)).toEqual([
      { propertyId: '111', displayName: 'Acme Web' },
      { propertyId: '222', displayName: 'Acme Shop' },
    ])
    expect(f.mock.calls[0]![0]).toBe(`${ADMIN}/accountSummaries?pageSize=200`)
  })

  it('follows nextPageToken until it is absent', async () => {
    const f = sequence(
      res(200, { accountSummaries: [{ propertySummaries: [{ property: 'properties/1', displayName: 'A' }] }], nextPageToken: 'tok 2' }),
      res(200, { accountSummaries: [{ propertySummaries: [{ property: 'properties/2', displayName: 'B' }] }] }),
    )
    expect(await listProperties('t', f)).toEqual([
      { propertyId: '1', displayName: 'A' }, { propertyId: '2', displayName: 'B' },
    ])
    expect(f).toHaveBeenCalledTimes(2)
    expect(f.mock.calls[1]![0]).toBe(`${ADMIN}/accountSummaries?pageSize=200&pageToken=tok%202`)
  })

  it('skips malformed summaries and treats no accounts as an empty list', async () => {
    const f = json(200, { accountSummaries: [null, { propertySummaries: [null, { property: 5 }, { property: 'properties/9' }] }] })
    expect(await listProperties('t', f)).toEqual([{ propertyId: '9', displayName: '' }])
    expect(await listProperties('t', json(200, {}))).toEqual([])
  })
})

describe('listWebStreams', () => {
  it('keeps only web streams (Review Focus 3: app streams are dropped)', async () => {
    const f = json(200, dataStreams)
    const streams = await listWebStreams('t', '111', f)
    expect(streams).toEqual([{ streamId: '1001', displayName: 'Acme site', defaultUri: 'https://acme.com' }])
    expect(f.mock.calls[0]![0]).toBe(`${ADMIN}/properties/111/dataStreams?pageSize=200`)
  })

  it('follows nextPageToken across pages', async () => {
    const f = sequence(
      res(200, { dataStreams: [dataStreams.dataStreams[1]], nextPageToken: 'p2' }),
      res(200, { dataStreams: [dataStreams.dataStreams[0]] }),
    )
    expect((await listWebStreams('t', '111', f)).map(s => s.streamId)).toEqual(['1001'])
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('refuses a property id that is not numeric, without calling Google', async () => {
    const f = json(200, {})
    await expect(listWebStreams('t', '111/../admin', f)).rejects.toMatchObject({ kind: 'misconfigured' })
    expect(f).not.toHaveBeenCalled()
  })
})

describe('listKeyEvents', () => {
  it('returns event names exactly as written, keeping case variants distinct', async () => {
    const f = json(200, keyEvents)
    expect(await listKeyEvents('t', '111', f)).toEqual(['generate_lead', 'Generate_Lead', 'purchase'])
    expect(f.mock.calls[0]![0]).toBe(`${ADMIN}/properties/111/keyEvents?pageSize=200`)
  })

  it('follows nextPageToken and skips entries without a string eventName', async () => {
    const f = sequence(
      res(200, { keyEvents: [{ eventName: 'a' }, { eventName: 7 }, null], nextPageToken: 'n' }),
      res(200, { keyEvents: [{ eventName: 'b' }] }),
    )
    expect(await listKeyEvents('t', '111', f)).toEqual(['a', 'b'])
  })
})

describe('runKeyEventReport request', () => {
  it('posts the exact dimensions, metric and filter GA4 documents', async () => {
    const f = json(200, reportThresholded)
    await runKeyEventReport('t', REPORT_INPUT, f)
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe(`${DATA}/properties/111:runReport`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      dateRanges: [{ startDate: '2026-09-22', endDate: '2026-09-29' }],
      dimensions: [{ name: 'date' }, { name: 'eventName' }, { name: 'source' }, { name: 'defaultChannelGroup' }],
      metrics: [{ name: 'keyEvents' }],
      dimensionFilter: {
        andGroup: {
          expressions: [
            { filter: { fieldName: 'streamId', stringFilter: { matchType: 'EXACT', value: '1001', caseSensitive: true } } },
            { filter: { fieldName: 'eventName', inListFilter: { values: ['generate_lead', 'purchase'], caseSensitive: true } } },
          ],
        },
      },
      limit: 10000,
      offset: 0,
    })
  })

  it('refuses a property id that is not numeric, without calling Google', async () => {
    const f = json(200, {})
    await expect(runKeyEventReport('t', { ...REPORT_INPUT, propertyId: '1:runReport?x=' }, f))
      .rejects.toMatchObject({ kind: 'misconfigured' })
    expect(f).not.toHaveBeenCalled()
  })

  it('makes no request at all for an empty event list', async () => {
    const f = json(200, {})
    expect(await runKeyEventReport('t', { ...REPORT_INPUT, eventNames: [] }, f)).toEqual({ rows: [], withheld: false })
    expect(f).not.toHaveBeenCalled()
  })

  it('maps API failures to typed errors', async () => {
    await expect(runKeyEventReport('t', REPORT_INPUT, json(429, errorQuota))).rejects.toMatchObject({ kind: 'quota' })
    await expect(runKeyEventReport('t', REPORT_INPUT, json(403, errorScope))).rejects.toMatchObject({ kind: 'scope_missing' })
  })
})

describe('runKeyEventReport rows', () => {
  it('converts YYYYMMDD to YYYY-MM-DD (Review Focus 1)', async () => {
    const { rows } = await runKeyEventReport('t', REPORT_INPUT, json(200, reportThresholded))
    expect(rows).toEqual([
      { date: '2026-09-28', eventName: 'generate_lead', source: 'google', channelGroup: 'Organic Search', count: 1 },
    ])
  })

  it('rejects an already-ISO date as malformed rather than passing it through', async () => {
    const body = structuredClone(reportThresholded)
    body.rows[0]!.dimensionValues[0]!.value = '2026-09-28'
    await expect(runKeyEventReport('t', REPORT_INPUT, json(200, body))).rejects
      .toMatchObject({ kind: 'unavailable', status: 200, code: 'malformed_rows' })
  })

  it.each(['20261340', '20260230', '2026928', '', 'abcdefgh'])('rejects the impossible date %j', async bad => {
    const body = structuredClone(reportThresholded)
    body.rows[0]!.dimensionValues[0]!.value = bad
    await expect(runKeyEventReport('t', REPORT_INPUT, json(200, body))).rejects.toMatchObject({ code: 'malformed_rows' })
  })

  it.each(['abc', '', 'NaN'])('rejects the non-numeric count %j', async bad => {
    const body = structuredClone(reportThresholded)
    body.rows[0]!.metricValues[0]!.value = bad
    await expect(runKeyEventReport('t', REPORT_INPUT, json(200, body))).rejects.toMatchObject({ code: 'malformed_rows' })
  })

  it('rejects a row with a missing metric or too few dimensions', async () => {
    const noMetric = { rows: [{ dimensionValues: reportThresholded.rows[0]!.dimensionValues, metricValues: [] }], rowCount: 1 }
    const fewDims = { rows: [{ dimensionValues: [{ value: '20260928' }], metricValues: [{ value: '1' }] }], rowCount: 1 }
    await expect(runKeyEventReport('t', REPORT_INPUT, json(200, noMetric))).rejects.toMatchObject({ code: 'malformed_rows' })
    await expect(runKeyEventReport('t', REPORT_INPUT, json(200, fewDims))).rejects.toMatchObject({ code: 'malformed_rows' })
  })

  it('rejects a row with no eventName, since the event is what the row is keyed on', async () => {
    const body = structuredClone(reportThresholded)
    body.rows[0]!.dimensionValues[1]!.value = ''
    await expect(runKeyEventReport('t', REPORT_INPUT, json(200, body))).rejects.toMatchObject({ code: 'malformed_rows' })
  })

  it('coerces a missing or non-string source and channel group to an empty string', async () => {
    const body = {
      rows: [{
        dimensionValues: [{ value: '20260928' }, { value: 'purchase' }, {}, { value: 7 }],
        metricValues: [{ value: '3' }],
      }],
      rowCount: 1,
    }
    const { rows } = await runKeyEventReport('t', REPORT_INPUT, json(200, body))
    expect(rows).toEqual([{ date: '2026-09-28', eventName: 'purchase', source: '', channelGroup: '', count: 3 }])
    expect(typeof rows[0]!.source).toBe('string')
  })

  it('treats a report with no rows key as an empty result', async () => {
    expect(await runKeyEventReport('t', REPORT_INPUT, json(200, { rowCount: 0 }))).toEqual({ rows: [], withheld: false })
  })

  it('rejects a non-JSON 200 as unavailable', async () => {
    await expect(runKeyEventReport('t', REPORT_INPUT, raw(200, '<html>'))).rejects
      .toMatchObject({ kind: 'unavailable', code: 'malformed_body' })
  })
})

describe('runKeyEventReport pagination and withholding', () => {
  it('concatenates two pages, advancing offset by the rows already received', async () => {
    const f = sequence(res(200, reportPage1), res(200, reportPage2))
    const { rows, withheld } = await runKeyEventReport('t', REPORT_INPUT, f)
    expect(rows.map(r => [r.date, r.eventName, r.source, r.count])).toEqual([
      ['2026-09-28', 'generate_lead', 'google', 4],
      ['2026-09-28', 'generate_lead', 'chatgpt.com', 2],
      ['2026-09-29', 'purchase', '(direct)', 1],
    ])
    expect(withheld).toBe(false)
    expect(f).toHaveBeenCalledTimes(2)
    expect(JSON.parse(f.mock.calls[0]![1].body).offset).toBe(0)
    expect(JSON.parse(f.mock.calls[1]![1].body).offset).toBe(2)
  })

  it('stops when a page comes back empty even if rowCount promises more', async () => {
    const f = sequence(res(200, reportPage1), res(200, { rows: [], rowCount: 99 }))
    const { rows } = await runKeyEventReport('t', REPORT_INPUT, f)
    expect(rows).toHaveLength(2)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('caps at 20 pages and reports the window as incomplete', async () => {
    const page = { ...reportPage1, rowCount: 1_000_000 }
    const f = vi.fn().mockImplementation(async () => res(200, page))
    const { rows, withheld } = await runKeyEventReport('t', REPORT_INPUT, f)
    expect(f).toHaveBeenCalledTimes(20)
    expect(rows).toHaveLength(40)
    expect(withheld).toBe(true)
  })

  it('reports withheld when the thresholded fixture says subjectToThresholding', async () => {
    expect((await runKeyEventReport('t', REPORT_INPUT, json(200, reportThresholded))).withheld).toBe(true)
  })

  it('reports withheld for dataLossFromOtherRow', async () => {
    const body = { ...reportThresholded, metadata: { dataLossFromOtherRow: true } }
    expect((await runKeyEventReport('t', REPORT_INPUT, json(200, body))).withheld).toBe(true)
  })

  it('reports withheld if either flag is set on any page, not just the last', async () => {
    const page1 = { ...reportPage1, metadata: { subjectToThresholding: true } }
    const f = sequence(res(200, page1), res(200, reportPage2))
    expect((await runKeyEventReport('t', REPORT_INPUT, f)).withheld).toBe(true)
  })
})

describe('runKeyEventReport deadline', () => {
  it('requests nothing and throws when the deadline has already passed', async () => {
    const f = json(200, reportPage1)
    await expect(runKeyEventReport('t', { ...REPORT_INPUT, deadline: 1_000, now: () => 1_000 }, f))
      .rejects.toBeInstanceOf(DeadlineReachedError)
    expect(f).not.toHaveBeenCalled()
  })

  it('requests no further page once the deadline passes between pages', async () => {
    let clock = 0
    const more = { ...reportPage1, rowCount: 1_000 }
    const f = vi.fn().mockImplementation(async () => { clock += 500; return res(200, more) })
    await expect(runKeyEventReport('t', { ...REPORT_INPUT, deadline: 600, now: () => clock }, f))
      .rejects.toBeInstanceOf(DeadlineReachedError)
    expect(f).toHaveBeenCalledTimes(2)
  })
})
