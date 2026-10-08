import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const h=vi.hoisted(()=>({profile:vi.fn(),detail:vi.fn()}))
vi.mock('@/lib/auth',()=>({getProfile:h.profile}))
vi.mock('@/lib/observations/store',()=>({loadObservationDetail:h.detail,loadObservationSnapshot:vi.fn()}))
import {GET} from '@/app/api/clients/[clientId]/observations/[observationId]/route'
import {projectObservationDetail,textEvidenceLinks} from '@/lib/observations/schema'
const clientId='11111111-1111-4111-8111-111111111111',observationId='22222222-2222-4222-8222-222222222222'
const request=()=>new Request('http://localhost/detail')
const context=(client=clientId,id=observationId)=>({params:Promise.resolve({clientId:client,observationId:id})})
beforeEach(()=>{vi.resetAllMocks();h.profile.mockResolvedValue({account_id:'session-account'});vi.spyOn(console,'error').mockImplementation(()=>{})})
afterEach(()=>vi.restoreAllMocks())
describe('observation detail',()=>{
  it('prefers provider provenance over duplicate text links and preserves legacy unknown',()=>{
    const row={id:observationId,prompt_id:null,question:'Question',platform:'chatgpt',scan_week:'2026-10-05',
      created_at:null,raw_answer:'Read https://source.example/a and https://text.example/b',brand_mentioned:null,snapshot:null,brand_snapshot:null,
      requested_model:null,actual_model:null,collector:null,collector_version:null,provider_request_id:null,classifier_method:null,
      classifier_version:null,sentiment:null,matched_text:null,provider_citations:[{url:'https://source.example/a',title:'Source'}],provider_finish_reason:'stop'}
    const dto=projectObservationDetail(row)
    expect(dto.links).toEqual([{url:'https://source.example/a',title:'Source',kind:'provider-citation'},{url:'https://text.example/b',kind:'text-link'}])
    expect(dto.limitations).not.toContain('provider-citations-unrecorded')
    expect(projectObservationDetail({...row,provider_citations:null}).limitations).toContain('provider-citations-unrecorded')
    expect(projectObservationDetail({...row,provider_citations:[]}).limitations).not.toContain('provider-citations-unrecorded')
  })
  it('other_tenant_gets_404 with no original answer or diagnostic leakage',async()=>{
    h.detail.mockResolvedValue(null)
    const response=await GET(request(),context())
    expect(response.status).toBe(404);expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({error:'CLIENT_NOT_FOUND'})
    expect(h.detail).toHaveBeenCalledWith('session-account',clientId,observationId)
  })
  it('reads only authenticated account and returns the saved evidence',async()=>{
    h.detail.mockResolvedValue({id:observationId,rawAnswer:'Frozen original answer'})
    const response=await GET(request(),context())
    expect(response.status).toBe(200);expect(await response.json()).toEqual({observation:{id:observationId,rawAnswer:'Frozen original answer'}})
    expect(h.detail).toHaveBeenCalledWith('session-account',clientId,observationId)
  })
  it('rejects unauthenticated requests before store access',async()=>{
    h.profile.mockResolvedValue(null)
    expect((await GET(request(),context())).status).toBe(401);expect(h.detail).not.toHaveBeenCalled()
  })
  it.each([['bad',observationId],[clientId,'bad']])('validates both path UUIDs',async(client,id)=>{
    expect((await GET(request(),context(client,id))).status).toBe(400);expect(h.detail).not.toHaveBeenCalled()
  })
  it('does not disclose provider answer in storage failures',async()=>{
    h.detail.mockRejectedValue(new Error('private raw answer postgresql://hidden'))
    const response=await GET(request(),context())
    expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'OBSERVATIONS_UNAVAILABLE'})
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private raw answer')
  })
  it('text_link_is_not_verified_citation and unsafe URL is not executable',()=>{
    expect(textEvidenceLinks('https://example.com/page. https://example.com/page javascript:alert(1) https://user:secret@example.com/ http://127.0.0.1/ http://localhost/ https://example.local/'))
      .toEqual([{url:'https://example.com/page',kind:'text-link'}])
  })
  it('legacy evidence stays unknown instead of borrowing current model settings',()=>{
    const dto=projectObservationDetail({id:observationId,prompt_id:null,question:'Historical',platform:'chatgpt',scan_week:'2026-09-21',
      created_at:null,raw_answer:'Historical <script>alert(1)</script>',brand_mentioned:true,snapshot:null,brand_snapshot:null,
      requested_model:null,actual_model:null,collector:null,collector_version:null,provider_request_id:null,classifier_method:null,
      classifier_version:null,sentiment:'positive',matched_text:null})
    expect(dto).toMatchObject({rawAnswer:'Historical <script>alert(1)</script>',promptSnapshot:null,model:null,
      classification:{status:'legacy_unknown',brandMentioned:null,sentiment:'unknown'},links:[]})
    expect(dto).not.toHaveProperty('account_id')
  })
})
