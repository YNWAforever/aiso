import {beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({auth:vi.fn(),load:vi.fn()}))
vi.mock('@/lib/auth',()=>({requireAuth:mocks.auth}))
vi.mock('@/lib/workspace/load-owned-pulse',()=>({loadOwnedPulse:mocks.load}))
vi.mock('next/navigation',()=>({notFound:()=>{throw new Error('NOT_FOUND')}}))
vi.mock('next-intl/server',()=>({getTranslations:async()=>()=>''}))
import Page from '@/app/[lang]/pulse/[clientId]/page'
const run=()=>Page({params:Promise.resolve({lang:'en',clientId:'client-a'})})
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({account_id:'account-a',accounts:null});mocks.load.mockResolvedValue(null)})
it('requires auth before Pulse reads',async()=>{mocks.auth.mockRejectedValue(new Error('SIGN_IN'));await expect(run()).rejects.toThrow('SIGN_IN');expect(mocks.load).not.toHaveBeenCalled()})
it('maps an ownership miss to404',async()=>{await expect(run()).rejects.toThrow('NOT_FOUND');expect(mocks.load).toHaveBeenCalledWith({clientId:'client-a',profile:{account_id:'account-a',accounts:null}})})
it('shows a load failure instead of404 or empty on lookup outage',async()=>{mocks.load.mockRejectedValue(new Error('SECRET DB'));const page=await run();expect(JSON.stringify(page)).toContain('Pulse could not load');expect(JSON.stringify(page)).not.toContain('SECRET DB')})
