import { beforeEach, expect, it, vi } from 'vitest'
const boundary=vi.hoisted(()=>({cookies:vi.fn(),notFound:vi.fn(()=>{throw new Error('NOT_FOUND')})}))
vi.mock('next/headers',()=>({cookies:boundary.cookies}))
vi.mock('next/navigation',()=>({notFound:boundary.notFound}))
import Page from '@/app/[lang]/audit-fixture-error/page'
beforeEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks()})
it('defaults to404 before reading any cookie or rendering the fixture',async()=>{
 vi.stubEnv('E2E_FIXTURE_MODE','')
 await expect(Page({params:Promise.resolve({lang:'en'})})).rejects.toThrow('NOT_FOUND')
 expect(boundary.cookies).not.toHaveBeenCalled()
})
it('injects a synthetic failure only under explicit fixture mode',async()=>{
 vi.stubEnv('E2E_FIXTURE_MODE','1')
 boundary.cookies.mockResolvedValue({get:()=>({value:'fail'})})
 await expect(Page({params:Promise.resolve({lang:'en'})})).rejects.toThrow('synthetic-private-error-marker')
})
